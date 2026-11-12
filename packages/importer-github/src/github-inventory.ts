import type { Octokit } from "octokit";
import {
  capabilityMarker,
  worstCapabilityMarker,
  withCapability,
  type CapabilityMarker,
  type CapabilityResult,
} from "./capabilities.js";

// Spec 072 inventory payloads — shapes are the importer→core contract in
// specs/072-github-branch-inventory/contracts/github-inventory.md. All
// entries are plain JSON stored verbatim in components.details.

export interface BranchListItem {
  name: string;
  commit?: { sha?: string; url?: string };
  protected?: boolean;
}

export interface BranchInventoryEntry {
  name: string;
  sha: string | null;
  url: string;
  protected: boolean;
  isDefault: boolean;
  lastActivityAt?: string;
}

export interface ReleaseInventoryEntry {
  id: number | null;
  tagName: string;
  name: string | null;
  publishedAt: string | null;
  prerelease: boolean;
  draft: boolean;
  targetCommitish: string | null;
  assetCount: number;
  assetsTotalBytes: number;
  htmlUrl: string;
}

export interface TagInventoryEntry {
  name: string;
  sha: string | null;
  htmlUrl: string;
}

export interface BranchDetail {
  committedAt: string | null;
}

export type BranchDetailFetcher = (
  branch: string,
) => Promise<CapabilityResult<BranchDetail>>;

/**
 * Fully paginated branch list — the single fetch shared by spec-011 branch
 * instance classification and the branch inventory (no duplicate API call).
 * Throws on failure; callers wrap with `withCapability`.
 */
export async function listAllBranches(
  octokit: Octokit,
  owner: string,
  repo: string,
  signal: AbortSignal,
): Promise<BranchListItem[]> {
  const branches: BranchListItem[] = [];
  for await (const { data } of octokit.paginate.iterator(
    octokit.rest.repos.listBranches,
    { owner, repo, per_page: 100 },
  )) {
    branches.push(...(data as BranchListItem[]));
    if (signal.aborted) break;
  }
  return branches;
}

/**
 * Cached per-branch detail fetcher — `GET /branches/{branch}` wrapped in
 * `withCapability`. Shared between the mapped-instance path (deployedAt)
 * and the opt-in activity lookup so each branch is fetched at most once.
 */
export function createBranchDetailFetcher(
  octokit: Octokit,
  owner: string,
  repo: string,
  signal: AbortSignal,
): BranchDetailFetcher {
  const cache = new Map<string, Promise<CapabilityResult<BranchDetail>>>();
  return (branch: string) => {
    let pending = cache.get(branch);
    if (!pending) {
      pending = withCapability(async () => {
        const res = await octokit.rest.repos.getBranch({
          owner,
          repo,
          branch,
          request: { signal },
        });
        const commit = (
          res.data as {
            commit?: { commit?: { committer?: { date?: string } } };
          }
        ).commit;
        return {
          committedAt: commit?.commit?.committer?.date ?? null,
        };
      });
      cache.set(branch, pending);
    }
    return pending;
  };
}

export interface BranchInventoryResult {
  entries: BranchInventoryEntry[];
  /** Worst-status marker across activity lookups — set only when activity is on. */
  activityMarker?: CapabilityMarker;
}

/**
 * Builds `details.branches[]` from the shared branch list. `isDefault`
 * follows the repo's reported `default_branch` — never a hardcoded name.
 * Activity timestamps are opt-in (one getBranch per branch, deduped through
 * the shared fetcher).
 */
export async function fetchBranchInventory(
  branches: BranchListItem[],
  repo: { html_url: string; default_branch: string | null },
  options: {
    includeActivity: boolean;
    getBranchDetail: BranchDetailFetcher;
    signal: AbortSignal;
  },
): Promise<BranchInventoryResult> {
  const entries: BranchInventoryEntry[] = [];
  let activityMarker: CapabilityMarker | undefined;

  for (const branch of branches) {
    if (options.signal.aborted) break;

    let lastActivityAt: string | undefined;
    if (options.includeActivity) {
      const detail = await options.getBranchDetail(branch.name);
      const marker = capabilityMarker(detail);
      activityMarker = activityMarker
        ? worstCapabilityMarker(activityMarker, marker)
        : marker;
      if (detail.status === "OK" && detail.data?.committedAt) {
        lastActivityAt = detail.data.committedAt;
      }
    }

    entries.push({
      name: branch.name,
      sha: branch.commit?.sha ?? null,
      url: `${repo.html_url}/tree/${encodeURIComponent(branch.name)}`,
      protected: branch.protected ?? false,
      isDefault: branch.name === repo.default_branch,
      ...(lastActivityAt ? { lastActivityAt } : {}),
    });
  }

  return { entries, activityMarker };
}

interface GithubReleaseItem {
  id?: number;
  tag_name?: string;
  name?: string | null;
  published_at?: string | null;
  prerelease?: boolean;
  draft?: boolean;
  target_commitish?: string | null;
  html_url?: string;
  assets?: { size?: number }[];
}

interface GithubTagItem {
  name?: string;
  commit?: { sha?: string };
}

function toReleaseEntry(r: GithubReleaseItem): ReleaseInventoryEntry | null {
  if (typeof r.tag_name !== "string" || !r.tag_name) return null;
  const assets = r.assets ?? [];
  return {
    id: r.id ?? null,
    tagName: r.tag_name,
    name: r.name ?? null,
    publishedAt: r.published_at ?? null,
    prerelease: r.prerelease ?? false,
    draft: r.draft ?? false,
    targetCommitish: r.target_commitish ?? null,
    assetCount: assets.length,
    assetsTotalBytes: assets.reduce((sum, a) => sum + (a.size ?? 0), 0),
    htmlUrl: r.html_url ?? "",
  };
}

async function listAllReleases(
  octokit: Octokit,
  owner: string,
  repo: string,
  signal: AbortSignal,
): Promise<ReleaseInventoryEntry[]> {
  const releases: ReleaseInventoryEntry[] = [];
  for await (const { data } of octokit.paginate.iterator(
    octokit.rest.repos.listReleases,
    { owner, repo, per_page: 100 },
  )) {
    for (const r of data as GithubReleaseItem[]) {
      const entry = toReleaseEntry(r);
      if (entry) releases.push(entry);
    }
    if (signal.aborted) break;
  }
  return releases;
}

async function listAllTags(
  octokit: Octokit,
  owner: string,
  repo: string,
  htmlUrl: string,
  signal: AbortSignal,
): Promise<TagInventoryEntry[]> {
  const tags: TagInventoryEntry[] = [];
  for await (const { data } of octokit.paginate.iterator(
    octokit.rest.repos.listTags,
    { owner, repo, per_page: 100 },
  )) {
    for (const t of data as GithubTagItem[]) {
      if (typeof t.name !== "string" || !t.name) continue;
      tags.push({
        name: t.name,
        sha: t.commit?.sha ?? null,
        htmlUrl: `${htmlUrl}/releases/tag/${encodeURIComponent(t.name)}`,
      });
    }
    if (signal.aborted) break;
  }
  return tags;
}

export interface VersionInventoryResult {
  releases: CapabilityResult<ReleaseInventoryEntry[]>;
  tags: CapabilityResult<TagInventoryEntry[]>;
}

/**
 * Releases + plain tags are independent fetches — a failure on one endpoint
 * must not discard the other (the `versionInventory` marker takes the worst
 * status across both).
 */
export async function fetchVersionInventory(
  octokit: Octokit,
  owner: string,
  repo: string,
  htmlUrl: string,
  signal: AbortSignal,
): Promise<VersionInventoryResult> {
  const [releases, tags] = await Promise.all([
    withCapability(() => listAllReleases(octokit, owner, repo, signal)),
    withCapability(() => listAllTags(octokit, owner, repo, htmlUrl, signal)),
  ]);
  // FR-007: tags[] carries plain tags *lacking* releases — release-backed
  // tags already appear in releases[]. When the releases fetch failed we
  // can't tell which tags are covered, so keep the full list (the
  // versionInventory marker already records the degradation).
  let tagsResult = tags;
  if (releases.status === "OK" && tags.status === "OK") {
    const releaseTagNames = new Set(releases.data.map((r) => r.tagName));
    tagsResult = {
      ...tags,
      data: tags.data.filter((t) => !releaseTagNames.has(t.name)),
    };
  }
  return { releases, tags: tagsResult };
}

/** Opt-in per-language byte breakdown — `GET /languages` (one call per repo). */
export async function fetchLanguageBreakdown(
  octokit: Octokit,
  owner: string,
  repo: string,
  signal: AbortSignal,
): Promise<CapabilityResult<Record<string, number>>> {
  return withCapability(async () => {
    const res = await octokit.rest.repos.listLanguages({
      owner,
      repo,
      request: { signal },
    });
    const out: Record<string, number> = {};
    for (const [lang, bytes] of Object.entries(
      res.data as Record<string, unknown>,
    )) {
      if (typeof bytes === "number" && Number.isFinite(bytes)) {
        out[lang] = bytes;
      }
    }
    return out;
  });
}
