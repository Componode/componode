/**
 * Generates the marked regions of `docs/api.md` from `docs/openapi.yaml`
 * (ADR-104). Hand-written prose outside `<!-- GENERATED:... -->` markers is
 * preserved; content inside markers is always regenerated.
 *
 * Usage: `pnpm --filter @componode/backend docs:api`
 *        `pnpm --filter @componode/backend docs:api:check`
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parse } from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
export const OPENAPI_PATH = join(REPO_ROOT, "docs", "openapi.yaml");
export const API_MD_PATH = join(REPO_ROOT, "docs", "api.md");

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

/** Human-readable meaning for each error code. The contract test enforces
 *  that every code in `openapi.yaml`'s Error.code enum has an entry here. */
const CODE_MEANINGS: Record<string, string> = {
  AUTH_INVALID_CREDENTIALS: "Bad username/password",
  AUTH_RATE_LIMITED: "Too many auth attempts",
  AUTH_NO_SESSION: "Missing/expired session (401)",
  AUTH_FORBIDDEN: "Insufficient role (403)",
  AUTH_USERNAME_TAKEN: "Username conflict (409)",
  AUTH_RESET_TOKEN_INVALID: "Invalid password reset token",
  AUTH_RESET_TOKEN_EXPIRED: "Expired password reset token",
  AUTH_RESET_TOKEN_USED: "Password reset token already used",
  OIDC_NOT_CONFIGURED: "OIDC is not configured (503)",
  OIDC_INVALID_STATE: "OIDC state mismatch",
  OIDC_INVALID_CODE: "Missing or invalid OIDC code",
  OIDC_TOKEN_VERIFICATION_FAILED: "OIDC token verification failed",
  OIDC_DISCOVERY_FAILED: "OIDC issuer discovery failed",
  CSRF_TOKEN_MISMATCH: "Missing/mismatched CSRF token on a state-changing request (403)",
  VALIDATION_FAILED: "Zod input validation failed (400)",
  NOT_FOUND: "Resource not found (404)",
  CONFLICT: "Generic conflict (409)",
  CYCLE_DETECTED: "COMPOSES edge would create a cycle (409)",
  INVALID_EDGE_TYPE: "Edge type/target constraint violated",
  REFERENCED: "Delete blocked by existing references",
  TYPE_CHANGE_BLOCKED: "Product type change not allowed",
  SLUG_TAKEN: "Slug uniqueness conflict",
  SLUG_CONFLICT: "Component-group slug already in use (409)",
  CONFIG_NOT_FOUND: "Importer config missing at run time (surfaced via run error fields)",
  RUN_IN_PROGRESS: "An import run is already in progress for this config (409)",
  RUN_NOT_ACTIVE: "Run is not PENDING/RUNNING and cannot be cancelled (409)",
  INTERNAL_ERROR: "Unhandled server error",
  CREDENTIAL_NOT_FOUND: "Credential not found (404)",
  CREDENTIAL_IN_USE: "Credential delete/update blocked by existing references (409)",
  CREDENTIAL_REVOKED: "Revoked credential cannot be resolved (409)",
  CREDENTIAL_MISSING_KEY: "Required secret key not covered by referenced credentials (400)",
  CREDENTIAL_KEY_COLLISION: "Same secret key provided by more than one source (400)",
  CREDENTIAL_KEY_UNAVAILABLE: "Credential store master key unavailable (503)",
  MANIFEST_NO_TEST: "Importer does not support credential testing (400)",
  CONVERSION_NOTHING_TO_CONVERT: "Config has no legacy env/file secret refs to convert (400)",
  LEGACY_SECRET_UNRESOLVABLE: "Legacy env/file secret reference could not be resolved (502)",
};

interface Operation {
  summary?: string;
  security?: unknown[];
  tags?: string[];
  servers?: { url: string }[];
  "x-permission"?: string;
}

export interface Spec {
  paths: Record<string, Record<string, Operation>>;
  components: { schemas: { Problem: { properties: { code: { enum: string[] } } } } };
}

export function loadSpec(path = OPENAPI_PATH): Spec {
  return parse(readFileSync(path, "utf-8")) as Spec;
}

function accessOf(op: Operation): string {
  if (Array.isArray(op.security) && op.security.length === 0) return "Public";
  if (op["x-permission"]) return `\`${op["x-permission"]}\``;
  return "Authenticated";
}

function displayPath(path: string, op: Operation): string {
  const pretty = path.replaceAll("{", ":").replaceAll("}", "");
  const outsideV1 = op.servers?.some((s) => s.url === "/");
  return outsideV1 ? `\`${pretty}\`` : `\`/api/v1${pretty}\``;
}

export function renderEndpointTable(spec: Spec, tag: string): string {
  const rows: string[] = [
    "| Method | Path | Description | Access |",
    "|---|---|---|---|",
  ];
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const m of METHODS) {
      const op = methods[m];
      if (!op || op.tags?.[0] !== tag) continue;
      rows.push(
        `| ${m.toUpperCase()} | ${displayPath(path, op)} | ${op.summary ?? ""} | ${accessOf(op)} |`,
      );
    }
  }
  return rows.join("\n");
}

export function renderErrorCodeTable(spec: Spec): string {
  const codes: string[] = spec.components.schemas.Problem.properties.code.enum;
  const rows = ["| Code | Meaning |", "|---|---|"];
  for (const code of codes) {
    const meaning = CODE_MEANINGS[code];
    if (!meaning) {
      throw new Error(
        `No CODE_MEANINGS entry for error code "${code}" — add one in packages/backend/scripts/generate-api-doc.ts`,
      );
    }
    rows.push(`| \`${code}\` | ${meaning} |`);
  }
  return rows.join("\n");
}

const MARKER_RE = /<!--\s*GENERATED:([A-Za-z0-9:-]+)\s*-->([\s\S]*?)<!--\s*\/GENERATED:\1\s*-->/g;

export function generateApiDoc(spec: Spec, current: string): string {
  const seen = new Set<string>();
  const eol = current.includes("\r\n") ? "\r\n" : "\n";
  const normalized = current.replace(/\r\n/g, "\n");
  const result = normalized.replace(MARKER_RE, (_m, key: string) => {
    seen.add(key);
    let body: string;
    if (key === "error-codes") {
      body = renderErrorCodeTable(spec);
    } else if (key.startsWith("table:")) {
      body = renderEndpointTable(spec, key.slice(6));
    } else {
      throw new Error(`Unknown GENERATED marker "${key}" in docs/api.md`);
    }
    return `<!-- GENERATED:${key} -->\n${body}\n<!-- /GENERATED:${key} -->`;
  });

  // Every table:* tag in the spec must have a marker in the doc
  const specTags = new Set<string>();
  for (const methods of Object.values(spec.paths)) {
    for (const m of METHODS) {
      const op = methods[m];
      if (op?.tags?.[0]) specTags.add(`table:${op.tags[0]}`);
    }
  }
  const missing = [...specTags].filter((t) => !seen.has(t));
  if (missing.length) {
    throw new Error(`docs/api.md is missing GENERATED markers for: ${missing.join(", ")}`);
  }

  return eol === "\n" ? result : result.replace(/\n/g, eol);
}

export function run(check: boolean): void {
  const spec = loadSpec();
  const current = readFileSync(API_MD_PATH, "utf-8");
  const next = generateApiDoc(spec, current);
  if (check) {
    if (next !== current) {
      console.error("docs/api.md is out of date — run `pnpm docs:api`");
      process.exit(1);
    }
    console.log("docs/api.md is up to date");
    return;
  }
  writeFileSync(API_MD_PATH, next);
  console.log("docs/api.md regenerated");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) run(process.argv.includes("--check"));
