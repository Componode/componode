/**
 * Generates the marked regions of `docs/importers/index.md` and each
 * `docs/importers/<name>.md` from the importer manifests
 * (`IMPORTER_PACKAGES` + `<pkg>/manifest`). Hand-written prose outside
 * `<!-- GENERATED:... -->` markers is preserved; content inside markers is
 * always regenerated.
 *
 * The docs contract (AGENTS.md → Documentation) treats these regions as
 * output: change the manifest/config schema, re-run this script. The
 * `--check` variant runs in CI — a stale region or a missing per-importer
 * page fails the build.
 *
 * Requires built workspace packages (`pnpm build`) — manifests resolve to
 * `dist/manifest.js` like the runtime registry does.
 *
 * Usage: `pnpm --filter @componode/backend docs:importers`
 *        `pnpm --filter @componode/backend docs:importers:check`
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { IMPORTER_PACKAGES } from "@componode/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const DOCS_IMPORTERS_DIR = join(REPO_ROOT, "docs", "importers");
const INDEX_PATH = join(DOCS_IMPORTERS_DIR, "index.md");

const CHECK_MODE = process.argv.includes("--check");

interface Manifest {
  name: string;
  label: string;
  description: string;
  configSchema: unknown;
  secrets?: { key: string; label: string; required: boolean }[];
  targetRefKey?: string;
  reportsSourceIdentity?: boolean;
  requiresAgent?: boolean;
}

async function loadManifests(): Promise<Manifest[]> {
  const manifests: Manifest[] = [];
  for (const pkg of IMPORTER_PACKAGES) {
    const mod = (await import(`${pkg}/manifest`)) as { manifest: Manifest };
    manifests.push(mod.manifest);
  }
  manifests.sort((a, b) => a.label.localeCompare(b.label));
  return manifests;
}

// --- Zod v4 introspection -------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySchema = any;

function defOf(schema: AnySchema) {
  return schema?._zod?.def ?? schema?.def ?? {};
}

/** Dig through refine/pipe wrappers until an object shape is found. */
function getShape(schema: AnySchema): Record<string, AnySchema> | null {
  for (let i = 0; i < 8 && schema; i++) {
    const def = defOf(schema);
    if (schema.shape) return schema.shape;
    if (def.shape) return def.shape;
    schema = def.in ?? def.schema ?? def.innerType ?? def.type_in;
  }
  return null;
}

function isOptional(schema: AnySchema): boolean {
  try {
    return schema.safeParse(undefined).success === true;
  } catch {
    return true;
  }
}

function unwrapped(schema: AnySchema): { inner: AnySchema; deflt?: string } {
  let inner = schema;
  let deflt: string | undefined;
  for (let i = 0; i < 8 && inner; i++) {
    const def = defOf(inner);
    const t = def.type;
    if (t === "default") {
      const dv = def.defaultValue;
      const resolved = typeof dv === "function" ? dv() : dv;
      deflt = typeof resolved === "string" ? `\`${resolved}\`` : `\`${JSON.stringify(resolved)}\``;
      inner = def.innerType ?? def.in;
      continue;
    }
    if (t === "optional" || t === "nullable" || t === "readonly") {
      inner = def.innerType ?? def.in;
      continue;
    }
    break;
  }
  return { inner, deflt };
}

function typeNameOf(schema: AnySchema): string {
  const { inner } = unwrapped(schema);
  const def = defOf(inner);
  const t: string = def.type ?? "unknown";
  switch (t) {
    case "string":
      return hasUrlFormat(def) ? "URL" : "string";
    case "number":
      return "number";
    case "boolean":
      return "bool";
    case "enum":
      return "enum";
    case "array": {
      const el = def.element ?? def.valueType;
      return `${typeNameOf(el)}[]`;
    }
    case "record":
      return "record";
    case "url":
      return "URL";
    default:
      return t;
  }
}

function hasUrlFormat(def: Record<string, unknown>): boolean {
  if (def.format === "url") return true;
  const checks = def.checks as { format?: string }[] | undefined;
  return Array.isArray(checks) && checks.some((c) => c?.format === "url");
}

function descriptionOf(schema: AnySchema): string {
  const d =
    schema?.description ??
    schema?.meta?.description ??
    defOf(schema).description ??
    "";
  return String(d).replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

// --- Rendering ------------------------------------------------------------

function secretsCell(manifest: Manifest): string {
  const req = (manifest.secrets ?? []).filter((s) => s.required);
  if (req.length === 0) return "none required";
  return req.map((s) => `\`${s.key}\``).join(", ");
}

function executionCell(manifest: Manifest): string {
  const base = manifest.requiresAgent
    ? "Import Agent only"
    : "hub or Import Agent";
  return manifest.targetRefKey ? `${base} · target profiles` : base;
}

function renderIndexTable(manifests: Manifest[]): string {
  const rows = manifests.map(
    (m) =>
      `| [${m.label}](./${m.name}) | ${m.description.replace(/\|/g, "\\|")} | ${secretsCell(m)} | ${executionCell(m)} |`,
  );
  return [
    "| Importer | What it imports | Required secrets | Execution |",
    "|---|---|---|---|",
    ...rows,
  ].join("\n");
}

function renderContractBlock(manifest: Manifest): string {
  const shape = getShape(manifest.configSchema) ?? {};
  const lines: string[] = [];

  const secrets = manifest.secrets ?? [];
  lines.push(
    secrets.length === 0
      ? "**Secrets:** none"
      : `**Secrets:** ${secrets
          .map((s) => `\`${s.key}\`${s.required ? " (required)" : ""}`)
          .join(", ")}`,
  );
  lines.push(`**Execution:** ${executionCell(manifest)}`);
  if (manifest.reportsSourceIdentity) {
    lines.push("**Source identity:** `context.reportSourceIdentity()`");
  }
  lines.push("");

  const fields = Object.entries(shape);
  if (fields.length > 0) {
    lines.push("| Field | Type | Required | Default | Description |");
    lines.push("|---|---|---|---|---|");
    for (const [name, field] of fields) {
      const { deflt } = unwrapped(field);
      lines.push(
        `| \`${name}\` | ${typeNameOf(field)} | ${isOptional(field) ? "no" : "yes"} | ${deflt ?? "—"} | ${descriptionOf(field) || "—"} |`,
      );
    }
  }
  return lines.join("\n");
}

// --- Region replacement ---------------------------------------------------

function replaceRegion(content: string, tag: string, body: string): string | null {
  const start = `<!-- GENERATED:${tag} -->`;
  const end = `<!-- /GENERATED:${tag} -->`;
  const startIdx = content.indexOf(start);
  const endIdx = content.indexOf(end);
  if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) return null;
  return (
    content.slice(0, startIdx + start.length) +
    "\n" +
    body +
    "\n" +
    content.slice(endIdx)
  );
}

// --- Main -----------------------------------------------------------------

async function main() {
  const manifests = await loadManifests();
  const problems: string[] = [];
  const writes: { path: string; content: string }[] = [];

  // index.md table
  const indexContent = readFileSync(INDEX_PATH, "utf-8");
  const nextIndex = replaceRegion(
    indexContent,
    "importers-table",
    renderIndexTable(manifests),
  );
  if (nextIndex === null) {
    problems.push(
      "docs/importers/index.md is missing <!-- GENERATED:importers-table --> markers",
    );
  } else {
    writes.push({ path: INDEX_PATH, content: nextIndex });
  }

  // per-importer pages
  for (const m of manifests) {
    const pagePath = join(DOCS_IMPORTERS_DIR, `${m.name}.md`);
    if (!existsSync(pagePath)) {
      problems.push(
        `importer "${m.name}" (${m.label}) has no docs/importers/${m.name}.md — add the setup guide`,
      );
      continue;
    }
    const page = readFileSync(pagePath, "utf-8");
    const next = replaceRegion(page, "contract", renderContractBlock(m));
    if (next === null) {
      problems.push(
        `docs/importers/${m.name}.md is missing <!-- GENERATED:contract --> markers`,
      );
      continue;
    }
    writes.push({ path: pagePath, content: next });
  }

  if (CHECK_MODE) {
    let stale = false;
    for (const w of writes) {
      if (readFileSync(w.path, "utf-8") !== w.content) {
        console.error(`stale: ${w.path.replace(REPO_ROOT, ".")}`);
        stale = true;
      }
    }
    for (const p of problems) console.error(p);
    if (stale || problems.length > 0) {
      console.error(
        "\nimporter docs out of date — run `pnpm --filter @componode/backend docs:importers`",
      );
      process.exit(1);
    }
    console.log("importer docs are up to date");
    return;
  }

  for (const p of problems) console.error(`WARN: ${p}`);
  for (const w of writes) {
    writeFileSync(w.path, w.content);
    console.log(`updated ${w.path.replace(REPO_ROOT, ".")}`);
  }
}

await main();
