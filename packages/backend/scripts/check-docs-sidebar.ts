/**
 * Sidebar oracle: every page under `docs/` must be reachable from the
 * docs-site chrome — nav or sidebar in `docs-site/.vitepress/config.ts`.
 * A page with no entry ships but can't be found (orphan).
 *
 * Usage: `pnpm --filter @componode/backend docs:sidebar:check`
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..", "..");
const DOCS_DIR = join(REPO_ROOT, "docs");
const CONFIG_PATH = join(
  REPO_ROOT,
  "docs-site",
  ".vitepress",
  "config.ts",
);

// Pages reachable without a sidebar/nav entry.
const EXEMPT = new Set(["index.md"]); // home — reached via the site logo

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      yield* walk(full);
    } else if (entry.endsWith(".md")) {
      yield full;
    }
  }
}

function docToLink(path: string): string {
  const rel = relative(DOCS_DIR, path).split(sep).join("/");
  if (rel === "index.md") return "/";
  if (rel.endsWith("/index.md")) return `/${rel.slice(0, -"index.md".length)}`;
  return `/${rel.slice(0, -".md".length)}`;
}

const config = readFileSync(CONFIG_PATH, "utf-8");
const links = new Set(
  [...config.matchAll(/link:\s*"([^"]+)"/g)].map((m) => m[1]),
);

const orphans: string[] = [];
for (const page of walk(DOCS_DIR)) {
  const rel = relative(DOCS_DIR, page).split(sep).join("/");
  if (EXEMPT.has(rel)) continue;
  const link = docToLink(page);
  if (!links.has(link)) {
    orphans.push(`  ${rel}  →  expected link "${link}"`);
  }
}

if (orphans.length > 0) {
  console.error(
    `docs pages missing from docs-site/.vitepress/config.ts nav/sidebar:\n${orphans.join("\n")}\n`,
  );
  process.exit(1);
}
console.log("all docs pages are linked from the site chrome");
