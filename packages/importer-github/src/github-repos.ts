import type { Octokit } from "octokit";
import type { DiscoveredAssetInstance, InstanceStatus } from "@componode/core";
import {
  capabilityMarker,
  worstCapabilityMarker,
  withCapability,
  type CapabilityMap,
  type CapabilityMarker,
} from "./capabilities.js";
import { resolveEnvironment } from "./mapping.js";
import type { GithubConfig } from "./config.js";
import type { BranchDetailFetcher, BranchListItem } from "./github-inventory.js";

export interface RepoLike {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
  html_url: string;
  pushed_at: string | null;
  default_branch: string | null;
}

export interface RepoInstanceDeps {
  /**
   * Shared paginated branch list — fetched once per repo by the caller and
   * used by both instance classification and the branch inventory.
   * `undefined` when the list call failed or was not needed.
   */
  branches: BranchListItem[] | undefined;
  /** Cached per-branch detail fetcher shared with the activity lookup. */
  getBranchDetail: BranchDetailFetcher;
  /** Per-repo degradation markers — mutated in place. */
  capabilities: CapabilityMap;
}

interface GithubEnvironment {
  name: string;
  protection_rules?: unknown;
  deployment_branch_policy?: unknown;
  can_admins_bypass?: unknown;
}

interface GithubDeployment {
  id: number;
  ref?: string;
  sha?: string;
  created_at?: string;
}

interface GithubDeploymentStatus {
  state?: string;
}

interface GithubRelease {
  tag_name?: string;
  published_at?: string | null;
}

function deploymentStatusToInstanceStatus(state: string | undefined): InstanceStatus {
  if (state === "failure" || state === "error") return "ERROR";
  return "RUNNING";
}

// Environment governance normalization (contract §3): allowlisted camelCase
// fields per protection-rule type — unknown types contribute `{type}` only,
// never raw provider payloads (ADR-121 spirit).
function normalizeProtectionRule(rule: unknown): Record<string, unknown> | null {
  if (!rule || typeof rule !== "object") return null;
  const r = rule as Record<string, unknown>;
  const type = typeof r.type === "string" ? r.type : null;
  if (!type) return null;

  const out: Record<string, unknown> = { type };
  switch (type) {
    case "wait_timer":
      if (typeof r.wait_timer === "number") out.waitTimerMinutes = r.wait_timer;
      break;
    case "required_reviewers":
      if (typeof r.prevent_self_review === "boolean") {
        out.preventSelfReview = r.prevent_self_review;
      }
      if (Array.isArray(r.reviewers)) out.reviewerCount = r.reviewers.length;
      break;
    case "branch_policy":
      if (typeof r.protected_branches === "boolean") {
        out.protectedBranches = r.protected_branches;
      }
      if (typeof r.custom_branch_policies === "boolean") {
        out.customBranchPolicies = r.custom_branch_policies;
      }
      break;
  }
  return out;
}

function githubEnvironmentGovernance(
  env: GithubEnvironment,
): Record<string, unknown> | null {
  const hasRules = Array.isArray(env.protection_rules);
  const policy =
    env.deployment_branch_policy !== null &&
    typeof env.deployment_branch_policy === "object"
      ? (env.deployment_branch_policy as Record<string, unknown>)
      : null;
  const hasBypass = typeof env.can_admins_bypass === "boolean";

  if (!hasRules && !policy && !hasBypass) return null;

  return {
    protectionRules: hasRules
      ? (env.protection_rules as unknown[])
          .map(normalizeProtectionRule)
          .filter((r): r is Record<string, unknown> => r !== null)
      : [],
    deploymentBranchPolicy: policy
      ? {
          protectedBranches:
            typeof policy.protected_branches === "boolean"
              ? policy.protected_branches
              : null,
          customBranchPolicies:
            typeof policy.custom_branch_policies === "boolean"
              ? policy.custom_branch_policies
              : null,
        }
      : null,
    canAdminsBypass: hasBypass ? env.can_admins_bypass : null,
  };
}

export async function buildRepoInstances(
  octokit: Octokit,
  repo: RepoLike,
  config: GithubConfig,
  signal: AbortSignal,
  deps: RepoInstanceDeps,
): Promise<DiscoveredAssetInstance[]> {
  const instances: DiscoveredAssetInstance[] = [];
  const owner = repo.owner.login;
  const repoName = repo.name;

  if (config.includeEnvironments) {
    const envsResult = await withCapability(async () => {
      const environments: GithubEnvironment[] = [];
      for await (const { data } of octokit.paginate.iterator(
        octokit.rest.repos.getAllEnvironments,
        { owner, repo: repoName, per_page: 100 },
      )) {
        environments.push(...(data as unknown as GithubEnvironment[]));
        if (signal.aborted) break;
      }
      return environments;
    });
    deps.capabilities.environments = capabilityMarker(envsResult);

    if (envsResult.status === "OK" && envsResult.data) {
      const environments = envsResult.data;

      let deploymentsMarker: CapabilityMarker = { status: "OK" };
      let deploymentsAttempted = false;
      let releasesMarker: CapabilityMarker | undefined;

      let release: GithubRelease | undefined;
      let releaseFetched = false;
      const getRelease = async () => {
        if (!releaseFetched) {
          releaseFetched = true;
          if (config.includeReleases) {
            const relResult = await withCapability(() =>
              octokit.rest.repos.getLatestRelease({
                owner,
                repo: repoName,
                request: { signal },
              }),
            );
            releasesMarker = capabilityMarker(relResult);
            release =
              relResult.status === "OK"
                ? (relResult.data.data as GithubRelease)
                : undefined;
          }
        }
        return release;
      };

      for (const env of environments) {
        if (signal.aborted) return instances;
        deploymentsAttempted = true;

        const depResult = await withCapability(() =>
          octokit.rest.repos.listDeployments({
            owner,
            repo: repoName,
            environment: env.name,
            per_page: 1,
            request: { signal },
          }),
        );
        deploymentsMarker = worstCapabilityMarker(
          deploymentsMarker,
          capabilityMarker(depResult),
        );
        const deployment =
          depResult.status === "OK"
            ? (depResult.data.data[0] as GithubDeployment | undefined)
            : undefined;

        let state: string | undefined;
        if (deployment) {
          const stResult = await withCapability(() =>
            octokit.rest.repos.listDeploymentStatuses({
              owner,
              repo: repoName,
              deployment_id: deployment.id,
              per_page: 1,
              request: { signal },
            }),
          );
          deploymentsMarker = worstCapabilityMarker(
            deploymentsMarker,
            capabilityMarker(stResult),
          );
          state =
            stResult.status === "OK"
              ? (stResult.data.data[0] as GithubDeploymentStatus | undefined)
                  ?.state
              : undefined;
        }

        let version = deployment?.ref ?? null;
        let deployedAt = deployment?.created_at ?? null;
        if ((!version || !deployedAt) && config.includeReleases) {
          const rel = await getRelease();
          version ??= rel?.tag_name ?? null;
          deployedAt ??= rel?.published_at ?? null;
        }

        const githubEnvironment = githubEnvironmentGovernance(env);

        instances.push({
          environment:
            resolveEnvironment(env.name, config.environmentMapping) ?? "OTHER",
          externalId: `env:${env.name}`,
          url: `${repo.html_url}/deployments/activity_log?environment=${encodeURIComponent(env.name)}`,
          status: deployment
            ? deploymentStatusToInstanceStatus(state)
            : "STOPPED",
          version,
          deployedAt,
          rawConfig: {
            environment: env.name,
            deploymentId: deployment?.id ?? null,
            deploymentState: state ?? null,
            ...(githubEnvironment ? { githubEnvironment } : {}),
          },
        });
      }

      if (deploymentsAttempted) {
        deps.capabilities.deployments = deploymentsMarker;
      }
      if (releasesMarker) {
        deps.capabilities.releases = releasesMarker;
      }
    }
  }

  // Spec-011 mapped branch instances — the environment mapping remains the
  // classifier-and-selector for INSTANCES only; the full branch list lives
  // in the component's details inventory (spec 072). Gated independently by
  // includeBranchInstances; the shared branch list + detail fetcher mean
  // the activity lookup never duplicates these getBranch calls.
  if (config.includeBranchInstances && deps.branches) {
    let branchInstancesMarker: CapabilityMarker = { status: "OK" };
    let attempted = false;

    for (const branch of deps.branches) {
      if (signal.aborted) return instances;

      const environment = resolveEnvironment(
        branch.name,
        config.environmentMapping,
      );
      if (!environment) continue;
      attempted = true;

      const detail = await deps.getBranchDetail(branch.name);
      branchInstancesMarker = worstCapabilityMarker(
        branchInstancesMarker,
        capabilityMarker(detail),
      );
      const lastCommit =
        detail.status === "OK" ? (detail.data?.committedAt ?? null) : null;

      instances.push({
        environment,
        externalId: `branch:${branch.name}`,
        url: `${repo.html_url}/tree/${encodeURIComponent(branch.name)}`,
        status: "RUNNING",
        version: branch.name,
        deployedAt: lastCommit ?? repo.pushed_at,
        rawConfig: { branch: branch.name },
      });
    }

    if (attempted) {
      deps.capabilities.branchInstances = branchInstancesMarker;
    }
  }

  return instances;
}
