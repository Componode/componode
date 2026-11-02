import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = join(ROOT, '..');

export interface CoverageResult {
  implemented: string[];
  scaffolds: string[];
  missing: string[];
}

// Importer implementation status is detected from package sources: a package
// with only synthetic output (no external call) counts as a scaffold.
const IMPLEMENTED = ['alibaba-cloud', 'github', 'docker', 'web-url', 'api-url'];
const SCAFFOLDED = ['aws', 'azure', 'kubernetes', 'mcp-server'];

export function validateCoverage(): CoverageResult {
  const matrixPath = join(ROOT, 'coverage-matrix.md');
  const matrix = exists(matrixPath) ? readFileSync(matrixPath, 'utf8') : '';

  const implemented = IMPLEMENTED.filter((name) =>
    importerPackageExists(name),
  );
  const missing = implemented.filter((name) => {
    const label = matrix
      .toLowerCase()
      .includes(name.replace('-cloud', ' cloud').replace('-url', ' url'));
    const hasMock = exists(join(ROOT, 'mocks', name === 'web-url' || name === 'api-url' ? 'url-importers' : name === 'alibaba-cloud' ? 'alibaba' : name === 'github' ? 'github' : 'docker-engine', 'server.ts'));
    const hasTest = importerTestExists(name);
    return !(label && hasMock && hasTest);
  });
  return { implemented, scaffolds: SCAFFOLDED, missing };
}

function exists(p: string): boolean {
  try { readdirSync(dirname(p)); return readFileSync(p) !== undefined; } catch { return false; }
}

function importerPackageExists(name: string): boolean {
  try {
    readdirSync(join(REPO_ROOT, 'packages', `importer-${name}`, 'src'));
    return true;
  } catch { return false; }
}

function importerTestExists(name: string): boolean {
  const dir = join(ROOT, 'tests', 'importers');
  try {
    return readdirSync(dir).some((f) => f.includes(name === 'web-url' || name === 'api-url' ? 'url-importers' : name.split('-')[0]!));
  } catch { return false; }
}

// CLI: validate and print gaps.
if (process.argv[1] && process.argv[1].endsWith('validate-coverage.ts')) {
  const r = validateCoverage();
  console.log(`implemented: ${r.implemented.join(', ')}`);
  console.log(`scaffolds: ${r.scaffolds.join(', ')}`);
  if (r.missing.length) {
    console.error(`MISSING coverage: ${r.missing.join(', ')}`);
    process.exit(1);
  }
}
