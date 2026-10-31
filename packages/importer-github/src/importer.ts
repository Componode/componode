import type { Octokit } from "octokit";
import { canonicalizeSourceIdentity, qualifyExternalId, type DiscoveredAsset, type Importer, type ImporterContext } from "@componode/core";
import { githubConfigSchema, type GithubConfig } from "./config.js";
import { buildOctokit } from "./client.js";
import { fetchOrganizationAsset } from "./github-org.js";
import { fetchBillingSnapshot, type RepoBilling } from "./github-billing.js";
import { buildRepoInstances, type RepoLike } from "./github-repos.js";
import {
  fetchWorkflowAssets,
  fetchRunnerAssets,
  fetchPackageAssets,
} from "./github-extras.js";
import { withCapability, warnIfDegraded, type CapabilityMap, type CapabilityMarker } from "./capabilities.js";

interface GithubRepo {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
  html_url: string;
  fork: boolean;
  archived: boolean;
  language: string | null;
  topics: string[] | null | undefined;
  visibility: string | null;
  default_branch: string | null;
  updated_at: string | null;
  pushed_at: string | null;
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
        signal,
      });
      yield response.data as GithubRepo;
    }
    return;
  }

  const iterator = octokit.paginate.iterator(octokit.rest.repos.listForOrg, {
    org,
    type: "all",
    per_page: 100,
    signal,
  });

  for await (const { data } of iterator) {
    if (signal.aborted) return;
    for (const repo of data as GithubRepo[]) {
      yield repo;
    }
  }
}

function buildDiscoveredAsset(
  repo: GithubRepo,
  instances: DiscoveredAsset["instances"],
  repoBilling: RepoBilling | undefined,
): DiscoveredAsset {
  return {
    category: "REPOSITORY",
    provider: "GITHUB",
    resourceType: "github:repository",
    name: repo.full_name,
    externalId: String(repo.id),
    slug: generateComponentSlug(repo.name),
    details: {
      language: repo.language,
      topics: repo.topics ?? [],
      visibility: repo.visibility,
      htmlUrl: repo.html_url,
      ...(repoBilling ? { billing: repoBilling } : {}),
    },
    instances,
  };
}

const GITHUB_API_BASE = "https://api.github.com";

export class GithubImporter implements Importer {
  readonly name = "github";
  readonly version = "1.1.0";

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
        signal: context.signal,
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
        : `${base}/login/${parsed.org}`;
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
        octokit.rest.rateLimit.get({ signal: context.signal }),
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
      const marker: CapabilityMarker = { status: "OK" };
      try {
        for await (const asset of fetchPackageAssets(octokit, parsed.org, context.signal)) {
          if (context.signal.aborted) return;
          packageAssets.push(asset);
        }
      } catch (err) {
        marker.status = "ERROR";
        marker.message = err instanceof Error ? err.message : String(err);
      }
      capabilities.packages = marker;
      warnIfDegraded(context.logger, "packages", marker);
    }

    if (parsed.includeOrganization && !context.signal.aborted) {
      context.reportPhase("Fetching organization");
      const orgAsset = await fetchOrganizationAsset(octokit, parsed, capabilities, context.signal, context.logger);
      if (billing) {
        (orgAsset.details as Record<string, unknown>).billing = billing.billing;
      }
      (orgAsset.details as Record<string, unknown>).capabilities = capabilities;
      yield qualifyGhes(orgAsset);
    }

    for (const asset of [...runnerAssets, ...packageAssets]) {
      yield qualifyGhes(asset);
    }

    context.reportPhase("Listing repositories");

    for await (const repo of listOrgRepos(octokit, parsed, context.signal)) {
      if (context.signal.aborted) {
        return;
      }

      if (!parsed.includeForks && repo.fork) continue;
      if (!parsed.includeArchived && repo.archived) continue;

      context.reportPhase(`Processing ${repo.full_name}`);

      const instances = await buildRepoInstances(octokit, repo as RepoLike, parsed, context.signal);
      const repoBilling = billing?.repoBilling.get(repo.full_name);
      yield qualifyGhes(buildDiscoveredAsset(repo, instances, repoBilling));

      if (parsed.includeWorkflows) {
        for await (const asset of fetchWorkflowAssets(octokit, repo, context.signal)) {
          if (context.signal.aborted) return;
          yield qualifyGhes(asset);
        }
      }
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
    const parsed = githubConfigSchema.partial().parse(config ?? {});
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
