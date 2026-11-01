/**
 * Generates the marked region of `docs/architecture.md` § Persistence model
 * from the `DB` interface in `packages/backend/src/db/types.ts` — the same
 * type Kysely compiles against, so the doc table can never drift from the
 * real schema.
 *
 * Usage: `pnpm --filter @componode/backend docs:schema`
 *        `pnpm --filter @componode/backend docs:schema:check`
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const TYPES_PATH = join(REPO_ROOT, "packages", "backend", "src", "db", "types.ts");
const ARCH_PATH = join(REPO_ROOT, "docs", "architecture.md");
const CHECK_MODE = process.argv.includes("--check");

function tableRows(): { table: string; row: string }[] {
  const src = readFileSync(TYPES_PATH, "utf-8");
  const dbMatch = src.match(/export interface DB \{(?<body>[\s\S]*?)\n\}/);
  if (!dbMatch?.groups?.body) {
    throw new Error("could not find `export interface DB` in types.ts");
  }
  return [...dbMatch.groups.body.matchAll(/^\s{2}(\w+):\s*(\w+);/gm)].map(
    (m) => ({ table: m[1], row: m[2] }),
  );
}

function render(rows: { table: string; row: string }[]): string {
  const lines = [
    `PostgreSQL holds **${rows.length} tables** (see \`DB\` in \`packages/backend/src/db/types.ts\`):`,
    "",
    "| Table | Row interface |",
    "|---|---|",
    ...rows.map((r) => `| \`${r.table}\` | \`${r.row}\` |`),
  ];
  return lines.join("\n");
}

const rows = tableRows();
const content = readFileSync(ARCH_PATH, "utf-8");
const start = "<!-- GENERATED:persistence-tables -->";
const end = "<!-- /GENERATED:persistence-tables -->";
const si = content.indexOf(start);
const ei = content.indexOf(end);
if (si === -1 || ei === -1) {
  console.error(
    "docs/architecture.md is missing <!-- GENERATED:persistence-tables --> markers",
  );
  process.exit(1);
}
const next =
  content.slice(0, si + start.length) + "\n" + render(rows) + "\n" + content.slice(ei);

if (CHECK_MODE) {
  if (readFileSync(ARCH_PATH, "utf-8") !== next) {
    console.error(
      "docs/architecture.md persistence table is stale — run `pnpm --filter @componode/backend docs:schema`",
    );
    process.exit(1);
  }
  console.log("persistence table is up to date");
} else {
  writeFileSync(ARCH_PATH, next);
  console.log(`updated ${ARCH_PATH.replace(REPO_ROOT, ".")} (${rows.length} tables)`);
}
