/**
 * Docs oracle: enumerable facts must appear in the docs that cover them.
 * Fails on drift rather than regenerating prose.
 *
 *   .env.example vars        → docs/deployment.md
 *   docker-compose services  → docs/deployment.md
 *   importer labels          → docs/architecture.md (Sources diagram/section)
 *   workspace package names  → docs/architecture.md (monorepo boundaries)
 *   core error codes         → docs/api.md
 *
 * Usage: `pnpm --filter @componode/backend docs:oracle:check`
 */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { IMPORTER_PACKAGES } from "@componode/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const read = (p: string) => readFileSync(join(REPO_ROOT, p), "utf-8");

const problems: string[] = [];

// .env.example vars → deployment.md
const deployment = read("docs/deployment.md");
for (const m of read(".env.example").matchAll(/^#?\s*([A-Z][A-Z0-9_]{2,})\s*=/gm)) {
  if (!deployment.includes(m[1])) {
    problems.push(`.env.example var \`${m[1]}\` not documented in docs/deployment.md`);
  }
}

// docker-compose services → deployment.md
const compose = read("docker-compose.yml");
const servicesBlock = compose.match(/^services:\n([\s\S]*?)(?=^\w|\n*volumes:|\n*networks:|\n*secrets:)/m)?.[1] ?? "";
for (const m of servicesBlock.matchAll(/^ {2}(\w[\w-]*):$/gm)) {
  if (!deployment.includes(m[1])) {
    problems.push(`compose service \`${m[1]}\` not documented in docs/deployment.md`);
  }
}

// importer labels → architecture.md
const architecture = read("docs/architecture.md");
for (const pkg of IMPORTER_PACKAGES) {
  const mod = (await import(`${pkg}/manifest`)) as {
    manifest: { label: string; name: string };
  };
  if (!architecture.includes(mod.manifest.label)) {
    problems.push(
      `importer "${mod.manifest.label}" not mentioned in docs/architecture.md`,
    );
  }
}

// workspace packages → architecture.md (core/backend/frontend/agent)
for (const pkg of ["agent", "core", "backend", "frontend"]) {
  if (
    !architecture.includes(`packages/${pkg}`) &&
    !architecture.includes(`@componode/${pkg}`) &&
    !architecture.includes(`\`${pkg}\``)
  ) {
    problems.push(`packages/${pkg} not mentioned in docs/architecture.md`);
  }
}

// core error codes → api.md
const apiMd = read("docs/api.md");
const codes = read("packages/core/src/constants/error-codes.ts");
for (const m of codes.matchAll(/"([A-Z][A-Z0-9_]+)"/g)) {
  if (!apiMd.includes(m[1])) {
    problems.push(`error code \`${m[1]}\` missing from docs/api.md`);
  }
}

if (problems.length > 0) {
  console.error(`docs drift detected:\n${problems.map((p) => `  ${p}`).join("\n")}\n`);
  process.exit(1);
}
console.log("docs oracle: no drift detected");
