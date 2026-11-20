import type { Octokit } from "octokit";
import {
  parseSpdxDocument,
  type DiscoveredBomEntry,
} from "@componode/core";
import type { CapabilityMarker } from "./capabilities.js";

// Spec 073 / FR-014 — repository package inventory. Primary source:
// `GET /repos/{o}/{r}/dependency-graph/sbom` (GitHub's SPDX 2.3 export,
// evidence REGISTRY_API). Fallback per research table: parse supported
// lockfiles/manifests off the default branch via the Contents API
// (evidence LOCK_FILE / MANIFEST_FILE, file path as evidenceDetail).
//
// Supported zero-dependency formats: package-lock.json (npm), go.sum
// (golang), Gemfile.lock (rubygems). Other ecosystems resolve through the
// dependency graph when available; an unsupported tree falls back to an
// absent field + degraded capability (never `[]`).

interface BomFetchResult {
  entries?: DiscoveredBomEntry[];
  marker: CapabilityMarker;
}

function stampEvidence(
  entries: DiscoveredBomEntry[],
  evidenceSource: DiscoveredBomEntry["evidenceSource"],
  evidenceDetail?: string,
): void {
  for (const entry of entries) {
    entry.evidenceSource = evidenceSource;
    if (evidenceDetail !== undefined) entry.evidenceDetail = evidenceDetail;
    if (entry.children) stampEvidence(entry.children, evidenceSource, evidenceDetail);
  }
}

async function fetchDepGraphSbom(
  octokit: Octokit,
  owner: string,
  repo: string,
  signal: AbortSignal,
): Promise<DiscoveredBomEntry[]> {
  const response = await octokit.request(
    "GET /repos/{owner}/{repo}/dependency-graph/sbom",
    { owner, repo, request: { signal } },
  );
  const doc = (response.data as { sbom?: unknown }).sbom ?? response.data;
  const { entries } = parseSpdxDocument(
    doc as Parameters<typeof parseSpdxDocument>[0],
  );
  stampEvidence(entries, "REGISTRY_API");
  return entries;
}

// ---- lockfile fallback -------------------------------------------------

const SUPPORTED_FILES: Record<
  string,
  { ecosystem: string; evidence: "LOCK_FILE" | "MANIFEST_FILE" }
> = {
  "package-lock.json": { ecosystem: "npm", evidence: "LOCK_FILE" },
  "go.sum": { ecosystem: "golang", evidence: "LOCK_FILE" },
  "Gemfile.lock": { ecosystem: "gem", evidence: "LOCK_FILE" },
};

interface LockPackage {
  name: string;
  version: string;
  dev?: boolean;
}

function parsePackageLock(json: string): LockPackage[] {
  let doc: unknown;
  try {
    doc = JSON.parse(json);
  } catch {
    return [];
  }
  const out: LockPackage[] = [];
  const root = doc as {
    packages?: Record<string, { version?: string; dev?: boolean }>;
    dependencies?: Record<
      string,
      { version?: string; dev?: boolean; dependencies?: unknown }
    >;
  };

  // lockfileVersion 2/3 — `packages` map keyed by install path.
  if (root.packages) {
    for (const [path, meta] of Object.entries(root.packages)) {
      const match = /node_modules\/((?:@[^/]+\/)?[^/]+)$/.exec(path);
      if (!match || !match[1] || !meta.version) continue;
      out.push({ name: match[1], version: meta.version, dev: meta.dev });
    }
    return out;
  }

  // lockfileVersion 1 — nested `dependencies` tree; flatten it.
  const walk = (
    deps: Record<
      string,
      { version?: string; dev?: boolean; dependencies?: unknown }
    >,
  ) => {
    for (const [name, meta] of Object.entries(deps)) {
      if (!meta.version) continue;
      out.push({ name, version: meta.version, dev: meta.dev });
      if (meta.dependencies && typeof meta.dependencies === "object") {
        walk(meta.dependencies as typeof deps);
      }
    }
  };
  if (root.dependencies) walk(root.dependencies);
  // Dedupe by name — the same package can appear at several depths.
  const seen = new Set<string>();
  return out.filter((p) => !seen.has(p.name) && seen.add(p.name));
}

function parseGoSum(text: string): LockPackage[] {
  const seen = new Set<string>();
  const out: LockPackage[] = [];
  for (const line of text.split("\n")) {
    const [mod, version] = line.trim().split(/\s+/);
    if (!mod || !version || seen.has(mod)) continue;
    seen.add(mod);
    out.push({ name: mod, version: version.replace(/\/go\.mod$/, "") });
  }
  return out;
}

function parseGemfileLock(text: string): LockPackage[] {
  const out: LockPackage[] = [];
  let inSpecs = false;
  for (const line of text.split("\n")) {
    if (/^  specs:$/.test(line)) {
      inSpecs = true;
      continue;
    }
    if (!inSpecs) continue;
    if (/^\S/.test(line)) break; // left the GEM block
    // 4-space indent = a resolved gem; deeper = its dependencies.
    const m = /^    ([\w.-]+) \(([^)]+)\)/.exec(line);
    if (m?.[1] && m[2]) out.push({ name: m[1], version: m[2] });
  }
  return out;
}

function toBomEntry(
  pkg: LockPackage,
  ecosystem: string,
  file: string,
): DiscoveredBomEntry {
  return {
    purl: `pkg:${ecosystem}/${encodeURIComponent(pkg.name)}@${pkg.version}`,
    name: pkg.name,
    version: pkg.version,
    scope: pkg.dev ? "DEV" : "RUNTIME",
    evidenceSource: "LOCK_FILE",
    evidenceDetail: `lockfile:${file}`,
  };
}

async function fetchLockfileBom(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string,
  signal: AbortSignal,
): Promise<DiscoveredBomEntry[] | null> {
  const listing = await octokit.rest.repos.getContent({
    owner,
    repo,
    path: "",
    ref,
    request: { signal },
  });
  const files = Array.isArray(listing.data) ? listing.data : [];
  const supported = files.find(
    (f) => f.type === "file" && SUPPORTED_FILES[f.name],
  );
  if (!supported) return null;

  const file = await octokit.rest.repos.getContent({
    owner,
    repo,
    path: supported.path,
    ref,
    request: { signal },
  });
  const data = file.data as { content?: string; encoding?: string };
  if (data.encoding !== "base64" || !data.content) return null;
  const text = Buffer.from(data.content, "base64").toString("utf8");

  const { ecosystem } = SUPPORTED_FILES[supported.name]!;
  let packages: LockPackage[] = [];
  if (supported.name === "package-lock.json") packages = parsePackageLock(text);
  else if (supported.name === "go.sum") packages = parseGoSum(text);
  else if (supported.name === "Gemfile.lock") packages = parseGemfileLock(text);
  if (packages.length === 0) return null;

  return packages.map((p) => toBomEntry(p, ecosystem, supported.path));
}

/**
 * Fetches a repository's package inventory, dependency graph first and
 * supported lockfiles second. Returns `entries` undefined when neither
 * source produced inventory — the caller omits `bomEntries` (FR-004) and
 * records the marker on the repo's capability map.
 */
export async function fetchRepoBom(
  octokit: Octokit,
  owner: string,
  repo: string,
  ref: string,
  signal: AbortSignal,
): Promise<BomFetchResult> {
  try {
    const entries = await fetchDepGraphSbom(octokit, owner, repo, signal);
    return { entries, marker: { status: "OK" } };
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (signal.aborted) throw err;
    // Graph unavailable — try lockfiles before declaring degradation.
    try {
      const fallback = await fetchLockfileBom(octokit, owner, repo, ref, signal);
      if (fallback) return { entries: fallback, marker: { status: "OK" } };
    } catch {
      /* fall through to the degraded marker */
    }
    const marker: CapabilityMarker =
      status === 403
        ? {
            status: "FORBIDDEN",
            message:
              "dependency graph is disabled or the token lacks the Dependency graph permission",
          }
        : status === 404
          ? { status: "UNAVAILABLE", message: "dependency graph endpoint not found" }
          : {
              status: "ERROR",
              message: err instanceof Error ? err.message : String(err),
            };
    return { marker };
  }
}
