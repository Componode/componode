import type { Octokit } from "octokit";
import {
  canonicalizeSourceIdentity,
  qualifyExternalId,
  mapEcosystemToProvider,
  normalizePurlIdentity,
  SPDX_EDGE_SUBJECT,
  type DiscoveredAsset,
  type DiscoveredAssetRelationship,
  type DiscoveredBomEntry,
  type Importer,
  type ImporterContext,
  type SpdxEdge,
} from "@componode/core";
import { githubConfigBase, githubConfigSchema, type GithubConfig } from "./config.js";
import { buildOctokit } from "./client.js";
import { fetchOrganizationAsset } from "./github-org.js";
import { fetchBillingSnapshot, type RepoBilling } from "./github-billing.js";
import { buildRepoInstances, type RepoLike } from "./github-repos.js";
import {
  createBranchDetailFetcher,
  fetchBranchInventory,
  fetchLanguageBreakdown,
  fetchVersionInventory,
  listAllBranches,
  type BranchInventoryEntry,
  type BranchListItem,
  type ReleaseInventoryEntry,
  type TagInventoryEntry,
} from "./github-inventory.js";
import {
  fetchWorkflowAssets,
  fetchRunnerAssets,
  fetchPackageAssets,
} from "./github-extras.js";
import { fetchRepoBom } from "./github-dependency-graph.js";
import {
  capabilityMarker,
  capabilityStatusRank,
  warnIfDegraded,
  worstCapabilityMarker,
  withCapability,
  type CapabilityMap,
  type CapabilityMarker,
} from "./capabilities.js";

interface GithubRepo extends RepoLike {
  fork: boolean;
  archived: boolean;
  disabled?: boolean;
  language: string | null;
  topics: string[] | null | undefined;
  visibility: string | null;
  created_at?: string | null;
  updated_at: string | null;
  size?: number | null;
  license?: {
    key?: string | null;
    name?: string | null;
    spdx_id?: string | null;
  } | null;
  open_issues_count?: number | null;
  parent?: { full_name?: string | null; html_url?: string | null } | null;
  source?: { full_name?: string | null; html_url?: string | null } | null;
}

function generateComponentSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function* listOrgRepos(
  octokit: Octokit,
  config: GithubConfig,
  signal: AbortSignal,
): AsyncGenerator<GithubRepo> {
  const org = config.org;

  if (config.repos && config.repos.length > 0) {
    for (const repo of config.repos) {
      if (signal.aborted) return;
      const [owner, repoName] = (repo.includes("/") ? repo.split("/", 2) : [org, repo]) as [string, string];
      const response = await octokit.rest.repos.get({
        owner,
        repo: repoName,
        request: { signal },
      });
      yield response.data as GithubRepo;
    }
    return;
  }

  const iterator = octokit.paginate.iterator(octokit.rest.repos.listForOrg, {
    org,
    type: "all",
    per_page: 100,
  });

  for await (const { data } of iterator) {
    if (signal.aborted) return;
    for (const repo of data as GithubRepo[]) {
      yield repo;
    }
  }
}

function repoRef(
  v: { full_name?: string | null; html_url?: string | null } | null | undefined,
): { fullName: string | null; htmlUrl: string | null } | null {
  return v
    ? { fullName: v.full_name ?? null, htmlUrl: v.html_url ?? null }
    : null;
}

interface RepoInventory {
  branches?: BranchInventoryEntry[];
  releases?: ReleaseInventoryEntry[];
  tags?: TagInventoryEntry[];
  languages?: Record<string, number>;
  capabilities: CapabilityMap;
}

function buildRepoDetails(
  repo: GithubRepo,
  repoBilling: RepoBilling | undefined,
  inventory: RepoInventory,
): Record<string, unknown> {
  return {
    language: repo.language,
    topics: repo.topics ?? [],
    visibility: repo.visibility,
    htmlUrl: repo.html_url,
    // Repo metadata scalars — always emitted (FR-010); the repo object is
    // already fetched, so these cost zero extra API calls.
    defaultBranch: repo.default_branch ?? null,
    archived: repo.archived ?? false,
    disabled: repo.disabled ?? false,
    fork: repo.fork ?? false,
    forkParent: repoRef(repo.parent),
    forkSource: repoRef(repo.source),
    sizeKb: repo.size ?? null,
    license: repo.license
      ? {
          key: repo.license.key ?? null,
          name: repo.license.name ?? null,
          spdxId: repo.license.spdx_id ?? null,
        }
      : null,
    openIssuesCount: repo.open_issues_count ?? null,
    createdAt: repo.created_at ?? null,
    pushedAt: repo.pushed_at ?? null,
    updatedAt: repo.updated_at ?? null,
    ...(repoBilling ? { billing: repoBilling } : {}),
    // Inventory keys are absent entirely when their toggle is off; `[]`
    // when on but the source legitimately returns empty.
    ...(inventory.branches ? { branches: inventory.branches } : {}),
    ...(inventory.releases ? { releases: inventory.releases } : {}),
    ...(inventory.tags ? { tags: inventory.tags } : {}),
    ...(inventory.languages ? { languages: inventory.languages } : {}),
    capabilities: inventory.capabilities,
  };
}

function buildDiscoveredAsset(
  repo: GithubRepo,
  instances: DiscoveredAsset["instances"],
  details: Record<string, unknown>,
  bomEntries?: DiscoveredBomEntry[],
  relationships?: DiscoveredAssetRelationship[],
): DiscoveredAsset {
  return {
    category: "REPOSITORY",
    provider: "GITHUB",
    resourceType: "github:repository",
    name: repo.full_name,
    externalId: String(repo.id),
    slug: generateComponentSlug(repo.name),
    details,
    instances,
    // bomEntries is attached only when collection ran — presence semantics
    // (present incl. [] replaces; absent preserves) live in ADR-131.
    ...(bomEntries !== undefined ? { bomEntries } : {}),
    ...(relationships !== undefined && relationships.length > 0
      ? { relationships }
      : {}),
  };
}

// ADR-133 / spec 076 — a SPDX package surfaced as a first-class LIBRARY
// component. `externalId` is the normalized version-free purl identity so
// the (LIBRARY, provider, externalId) dedup triple merges with Phase-2
// curated libraries; never GHES-qualified — purls are endpoint-global.
function purlType(purl: string): string {
  const body = purl.replace(/^pkg:/, "").split("@")[0]!;
  return body.split("/")[0] || "generic";
}

function buildLibraryAsset(
  identity: string,
  entry: DiscoveredBomEntry,
  relationships: DiscoveredAssetRelationship[],
): DiscoveredAsset {
  const type = purlType(entry.purl);
  return {
    category: "LIBRARY",
    provider: mapEcosystemToProvider(type, entry.purl),
    resourceType: type,
    name: entry.name,
    externalId: identity,
    slug: `pkg-${generateComponentSlug(type)}-${generateComponentSlug(entry.name)}`,
    instances: [],
    details: {
      purl: entry.purl,
      ...(entry.version ? { version: entry.version } : {}),
    },
    ...(relationships.length > 0 ? { relationships } : {}),
  };
}

/** Flatten the entry tree and index each package by its normalized
 *  version-free purl identity (dedup target of the edge endpoints). */
function indexBomEntries(
  entries: DiscoveredBomEntry[],
): Map<string, DiscoveredBomEntry> {
  const out = new Map<string, DiscoveredBomEntry>();
  const walk = (list: DiscoveredBomEntry[]) => {
    for (const e of list) {
      const identity = normalizePurlIdentity(e.purl);
      if (identity && !out.has(identity)) out.set(identity, e);
      if (e.children) walk(e.children);
    }
  };
  walk(entries);
  return out;
}

const GITHUB_API_BASE = "https://api.github.com";

export class GithubImporter implements Importer {
  readonly name = "github";
  readonly version = "1.2.0";

  async *run(
    config: Record<string, unknown>,
    secrets: Record<string, string>,
    context: ImporterContext,
  ): AsyncGenerator<DiscoveredAsset> {
    const parsed = githubConfigSchema.parse(config);
    context.reportPhase("Authenticating");

    const octokit = buildOctokit(parsed, secrets);

    // Source identity (ADR-120 A2): {canonicalBaseUrl}org/{orgId} in
    // path form — URL canonicalization strips `#` fragments, which would
    // collapse every org into one Source. Fetched before the first
    // yield — including empty inventories. GHES numeric IDs collide
    // across instances, so GHES externalIds are qualified with the
    // source identity; github.com IDs stay unqualified.
    const canonicalBase = canonicalizeSourceIdentity(
      parsed.baseUrl ?? GITHUB_API_BASE,
    );
    let orgId: number | string | undefined;
    try {
      const orgResponse = await octokit.rest.orgs.get({
        org: parsed.org,
        request: { signal: context.signal },
      });
      orgId = (orgResponse.data as { id?: number | string }).id;
    } catch (err) {
      // Only permission-style failures fall back to the login identity —
      // network/5xx errors must still fail the run rather than invent a
      // renamable source key (ADR-120).
      const status = (err as { status?: number }).status;
      if (status !== 403 && status !== 404) throw err;
      orgId = undefined;
    }
    // Fall back to the org login — mirrors the org asset's own
    // `login:` externalId fallback and keeps degraded (no org-read
    // permission) runs working; the identity is still unique per
    // instance+org. Path form (not `#` fragment): URL canonicalization
    // strips fragments, which would collapse every org into one Source
    // (ADR-120 Amendment 2).
    const base = canonicalBase.replace(/\/$/, "");
    const sourceIdentity =
      orgId !== undefined && orgId !== null
        ? `${base}/org/${orgId}`
        : `${base}/login/${encodeURIComponent(parsed.org)}`;
    await context.reportSourceIdentity({
      externalIdentity: sourceIdentity,
      label: parsed.org,
    });
    const qualifyGhes =
      canonicalBase !== canonicalizeSourceIdentity(GITHUB_API_BASE)
        ? (a: DiscoveredAsset): DiscoveredAsset => ({
            ...a,
            externalId: qualifyExternalId(sourceIdentity, a.externalId),
          })
        : (a: DiscoveredAsset): DiscoveredAsset => a;

    const logRateLimit = async () => {
      const rateLimit = await withCapability(() =>
        octokit.rest.rateLimit.get({ request: { signal: context.signal } }),
      );
      if (rateLimit.status === "OK" && rateLimit.data) {
        const core = (rateLimit.data.data as {
          resources?: { core?: { limit?: number; remaining?: number; used?: number } };
        }).resources?.core;
        context.logger.info("GitHub rate limit", {
          limit: core?.limit ?? null,
          remaining: core?.remaining ?? null,
          used: core?.used ?? null,
        });
      } else {
        context.logger.debug("GitHub rate limit check unavailable", {
          status: rateLimit.status,
          message: rateLimit.message ?? null,
        });
      }
    };

    await logRateLimit();

    const capabilities: CapabilityMap = {};

    if (context.signal.aborted) return;

    if (parsed.includeBilling) {
      context.reportPhase("Fetching billing usage");
    }
    const billing = parsed.includeBilling
      ? await fetchBillingSnapshot(octokit, parsed.org, parsed.billingPeriod, context.signal, context.logger)
      : null;
    if (billing) {
      capabilities.billing = {
        status: billing.billing.status,
        ...(billing.billing.message ? { message: billing.billing.message } : {}),
      };
    }

    const runnerAssets: DiscoveredAsset[] = [];
    if (parsed.includeRunners && !context.signal.aborted) {
      context.reportPhase("Listing organization runners");
      const marker: CapabilityMarker = { status: "OK" };
      try {
        for await (const asset of fetchRunnerAssets(octokit, parsed.org, context.signal)) {
          if (context.signal.aborted) return;
          runnerAssets.push(asset);
        }
      } catch (err) {
        marker.status = "ERROR";
        marker.message = err instanceof Error ? err.message : String(err);
      }
      capabilities.runners = marker;
      warnIfDegraded(context.logger, "runners", marker);
    }

    const packageAssets: DiscoveredAsset[] = [];
    if (parsed.includePackages && !context.signal.aborted) {
      context.reportPhase("Listing organization packages");
      let marker: CapabilityMarker = { status: "OK" };
      try {
        for await (const asset of fetchPackageAssets(
          octokit,
          parsed.org,
          context.signal,
          (degraded) => {
            marker = worstCapabilityMarker(marker, degraded);
          },
        )) {
          if (context.signal.aborted) return;
          packageAssets.push(asset);
        }
      } catch (err) {
        marker = { status: "ERROR", message: err instanceof Error ? err.message : String(err) };
      }
      capabilities.packages = marker;
      warnIfDegraded(context.logger, "packages", marker);
    }

    // The org asset is built early (its profile feeds nothing downstream,
    // but org-scoped capability markers must exist before repo-scoped ones
    // merge in) and yielded AFTER the repo loop so details.capabilities can
    // aggregate per-repo degradation worst-status-wins (research D5).
    let orgAsset: DiscoveredAsset | undefined;
    if (parsed.includeOrganization && !context.signal.aborted) {
      context.reportPhase("Fetching organization");
      orgAsset = await fetchOrganizationAsset(octokit, parsed, capabilities, context.signal, context.logger);
    }

    for (const asset of [...runnerAssets, ...packageAssets]) {
      yield qualifyGhes(asset);
    }

    context.reportPhase("Listing repositories");

    // Repo-scoped families rolled up onto the org asset: how many repos
    // reported each family degraded (for the aggregate marker message).
    const degradedRepoFamilies = new Map<string, number>();

    for await (const repo of listOrgRepos(octokit, parsed, context.signal)) {
      if (context.signal.aborted) {
        return;
      }

      if (!parsed.includeForks && repo.fork) continue;
      if (!parsed.includeArchived && repo.archived) continue;

      context.reportPhase(`Processing ${repo.full_name}`);

      const repoCaps: CapabilityMap = {};
      const owner = repo.owner.login;
      const repoName = repo.name;

      // One branch-list fetch shared by instance classification and the
      // branch inventory — skipped entirely when both consumers are off.
      const needBranchList =
        parsed.includeBranchInstances || parsed.includeBranchInventory;
      let branchList: BranchListItem[] | undefined;
      if (needBranchList) {
        const branchesResult = await withCapability(() =>
          listAllBranches(octokit, owner, repoName, context.signal),
        );
        // The shared fetch feeds two contract families — mark each under
        // its own consumer's toggle so a degraded list surfaces on both.
        if (parsed.includeBranchInventory) {
          repoCaps.branches = capabilityMarker(branchesResult);
        }
        if (parsed.includeBranchInstances) {
          repoCaps.branchInstances = capabilityMarker(branchesResult);
        }
        if (branchesResult.status === "OK") {
          branchList = branchesResult.data;
        }
      }

      const getBranchDetail = createBranchDetailFetcher(
        octokit,
        owner,
        repoName,
        context.signal,
      );

      const instances = await buildRepoInstances(
        octokit,
        repo,
        parsed,
        context.signal,
        { branches: branchList, getBranchDetail, capabilities: repoCaps },
      );

      let branches: BranchInventoryEntry[] | undefined;
      if (parsed.includeBranchInventory && branchList) {
        const result = await fetchBranchInventory(branchList, repo, {
          includeActivity: parsed.includeBranchActivity,
          getBranchDetail,
          signal: context.signal,
        });
        branches = result.entries;
        if (result.activityMarker) {
          repoCaps.branchActivity = result.activityMarker;
        }
      }

      let releases: ReleaseInventoryEntry[] | undefined;
      let tags: TagInventoryEntry[] | undefined;
      if (parsed.includeReleaseInventory) {
        const versionInventory = await fetchVersionInventory(
          octokit,
          owner,
          repoName,
          repo.html_url,
          context.signal,
        );
        repoCaps.versionInventory = worstCapabilityMarker(
          capabilityMarker(versionInventory.releases),
          capabilityMarker(versionInventory.tags),
        );
        if (versionInventory.releases.status === "OK") {
          releases = versionInventory.releases.data;
        }
        if (versionInventory.tags.status === "OK") {
          tags = versionInventory.tags.data;
        }
      }

      let bomEntries: DiscoveredBomEntry[] | undefined;
      let bomEdges: SpdxEdge[] | undefined;
      if (parsed.includeDependencyGraph) {
        const bom = await fetchRepoBom(
          octokit,
          owner,
          repoName,
          repo.default_branch ?? "main",
          context.signal,
        );
        repoCaps.bomInventory = bom.marker;
        if (bom.entries) bomEntries = bom.entries;
        // Lockfile fallback carries no graph — edges only on the dep-graph path.
        if (parsed.importDeclaredEdges) bomEdges = bom.edges;
      }

      let languages: Record<string, number> | undefined;
      if (parsed.includeLanguageBreakdown) {
        const languagesResult = await fetchLanguageBreakdown(
          octokit,
          owner,
          repoName,
          context.signal,
        );
        repoCaps.languages = capabilityMarker(languagesResult);
        if (languagesResult.status === "OK") {
          languages = languagesResult.data;
        }
      }

      // Per-repo degradation → warnings + worst-status-wins merge into the
      // org asset's capability map (yielded after this loop).
      for (const [family, marker] of Object.entries(repoCaps)) {
        warnIfDegraded(context.logger, `${repo.full_name}/${family}`, marker);
        if (marker.status !== "OK") {
          degradedRepoFamilies.set(
            family,
            (degradedRepoFamilies.get(family) ?? 0) + 1,
          );
        }
        const existing = capabilities[family];
        if (
          !existing ||
          capabilityStatusRank(marker.status) >
            capabilityStatusRank(existing.status)
        ) {
          capabilities[family] = { ...marker };
        }
      }

      const repoBilling = billing?.repoBilling.get(repo.full_name);
      const details = buildRepoDetails(repo, repoBilling, {
        branches,
        releases,
        tags,
        languages,
        capabilities: repoCaps,
      });
      // ADR-133 — when declared edges are opted in, SUBJECT-endpoint edges
      // (subject = the repository) attach to the repo asset; library↔
      // library edges attach to each declaring LIBRARY asset below.
      const repoRelationships = bomEdges
        ?.filter((e) => e.from === SPDX_EDGE_SUBJECT)
        .map((e) => ({ type: "DEPENDS_ON" as const, targetExternalId: e.to }));
      yield qualifyGhes(buildDiscoveredAsset(repo, instances, details, bomEntries, repoRelationships));

      // LIBRARY assets only when the SPDX graph produced edges data —
      // the lockfile-fallback path carries no graph.
      if (parsed.importDeclaredEdges && bomEdges !== undefined && bomEntries) {
        const byIdentity = indexBomEntries(bomEntries);
        for (const [identity, entry] of byIdentity) {
          const relationships = (bomEdges ?? [])
            .filter((e) => e.from === identity)
            .map((e) => ({ type: "DEPENDS_ON" as const, targetExternalId: e.to }));
          yield buildLibraryAsset(identity, entry, relationships);
        }
      }

      if (parsed.includeWorkflows) {
        for await (const asset of fetchWorkflowAssets(octokit, repo, context.signal)) {
          if (context.signal.aborted) return;
          yield qualifyGhes(asset);
        }
      }
    }

    if (orgAsset && !context.signal.aborted) {
      // Aggregate repo-scoped degradation onto the org markers — the
      // message notes how many repositories reported each family degraded.
      for (const [family, count] of degradedRepoFamilies) {
        const marker = capabilities[family];
        if (marker && marker.status !== "OK") {
          marker.message = marker.message
            ? `${marker.message} — affected repositories: ${count}`
            : `Affected repositories: ${count}`;
        }
      }
      if (billing) {
        (orgAsset.details as Record<string, unknown>).billing = billing.billing;
      }
      (orgAsset.details as Record<string, unknown>).capabilities = capabilities;
      yield qualifyGhes(orgAsset);
    }

    if (!context.signal.aborted) {
      await logRateLimit();
    }

    context.reportPhase("Completed");
  }

  // Credential test action (spec 013 US3): a minimal authenticated probe —
  // GET /rate_limit is cheap and always available. The error message is
  // status-only so it can never carry secret material.
  async testSecrets(
    secrets: Record<string, string>,
    config?: Record<string, unknown>,
  ) {
    const parsed = githubConfigBase.partial().parse(config ?? {});
    const octokit = buildOctokit(parsed as GithubConfig, secrets);
    try {
      await octokit.rest.rateLimit.get();
      return { ok: true };
    } catch (err) {
      const status = (err as { status?: number }).status;
      return {
        ok: false,
        error:
          status === 401
            ? "Authentication failed (401): check the token"
            : `GitHub request failed${status ? ` (${status})` : ""}`,
      };
    }
  }
}
