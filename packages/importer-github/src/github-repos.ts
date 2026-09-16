import type { Octokit } from "octokit";
import type { DiscoveredAssetInstance, InstanceStatus } from "@componode/core";
import { withCapability } from "./capabilities.js";
import { resolveEnvironment } from "./mapping.js";
import type { GithubConfig } from "./config.js";

export interface RepoLike {
  id: number;
  full_name: string;
  name: string;
  owner: { login: string };
  html_url: string;
  pushed_at: string | null;
  default_branch: string | null;
}

interface GithubEnvironment {
  name: string;
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

interface GithubBranch {
  name: string;
  commit?: { commit?: { committer?: { date?: string } } };
}

function deploymentStatusToInstanceStatus(state: string | undefined): InstanceStatus {
  if (state === "failure" || state === "error") return "ERROR";
  return "RUNNING";
}

async function latestDeployment(
  octokit: Octokit,
  owner: string,
  repo: string,
  environment: string,
  signal: AbortSignal,
): Promise<{ deployment?: GithubDeployment; state?: string }> {
  const depResult = await withCapability(() =>
    octokit.rest.repos.listDeployments({
      owner,
      repo,
      environment,
      per_page: 1,
      signal,
    }),
  );
  const deployment = depResult.status === "OK" ? (depResult.data.data[0] as GithubDeployment | undefined) : undefined;
  if (!deployment) return {};

  const stResult = await withCapability(() =>
    octokit.rest.repos.listDeploymentStatuses({
      owner,
      repo,
      deployment_id: deployment.id,
      per_page: 1,
      signal,
    }),
  );
  const state = stResult.status === "OK"
    ? (stResult.data.data[0] as GithubDeploymentStatus | undefined)?.state
    : undefined;

  return { deployment, state };
}

async function latestRelease(
  octokit: Octokit,
  owner: string,
  repo: string,
  signal: AbortSignal,
): Promise<GithubRelease | undefined> {
  const relResult = await withCapability(() =>
    octokit.rest.repos.getLatestRelease({ owner, repo, signal }),
  );
  return relResult.status === "OK" ? (relResult.data.data as GithubRelease) : undefined;
}

export async function buildRepoInstances(
  octokit: Octokit,
  repo: RepoLike,
  config: GithubConfig,
  signal: AbortSignal,
): Promise<DiscoveredAssetInstance[]> {
  const instances: DiscoveredAssetInstance[] = [];
  const owner = repo.owner.login;
  const repoName = repo.name;

  if (config.includeEnvironments) {
    const envsResult = await withCapability(() =>
      octokit.rest.repos.getAllEnvironments({ owner, repo: repoName, per_page: 100, signal }),
    );

    if (envsResult.status === "OK") {
      const environments =
        (envsResult.data.data as { environments?: GithubEnvironment[] }).environments ?? [];

      let release: GithubRelease | undefined;
      let releaseFetched = false;
      const getRelease = async () => {
        if (!releaseFetched) {
          releaseFetched = true;
          release = config.includeReleases
            ? await latestRelease(octokit, owner, repoName, signal)
            : undefined;
        }
        return release;
      };

      for (const env of environments) {
        if (signal.aborted) return instances;

        const { deployment, state } = await latestDeployment(
          octokit,
          owner,
          repoName,
          env.name,
          signal,
        );

        let version = deployment?.ref ?? null;
        let deployedAt = deployment?.created_at ?? null;
        if ((!version || !deployedAt) && config.includeReleases) {
          const rel = await getRelease();
          version ??= rel?.tag_name ?? null;
          deployedAt ??= rel?.published_at ?? null;
        }

        instances.push({
          environment: resolveEnvironment(env.name, config.environmentMapping) ?? "OTHER",
          externalId: `env:${env.name}`,
          url: `${repo.html_url}/deployments/activity_log?environment=${encodeURIComponent(env.name)}`,
          status: deployment ? deploymentStatusToInstanceStatus(state) : "STOPPED",
          version,
          deployedAt,
          rawConfig: {
            environment: env.name,
            deploymentId: deployment?.id ?? null,
            deploymentState: state ?? null,
          },
        });
      }
    }
  }

  const branchesResult = await withCapability(async () => {
    const names: string[] = [];
    for await (const { data } of octokit.paginate.iterator(
      octokit.rest.repos.listBranches,
      { owner, repo: repoName, per_page: 100, signal },
    )) {
      for (const b of data as { name: string }[]) {
        names.push(b.name);
      }
    }
    return names;
  });

  if (branchesResult.status === "OK" && branchesResult.data) {
    for (const branch of branchesResult.data) {
      if (signal.aborted) return instances;

      const environment = resolveEnvironment(branch, config.environmentMapping);
      if (!environment) continue;

      const branchResult = await withCapability(() =>
        octokit.rest.repos.getBranch({ owner, repo: repoName, branch, signal }),
      );
      const branchData = branchResult.status === "OK"
        ? (branchResult.data.data as GithubBranch)
        : undefined;
      const lastCommit = branchData?.commit?.commit?.committer?.date ?? null;

      instances.push({
        environment,
        externalId: `branch:${branch}`,
        url: `${repo.html_url}/tree/${encodeURIComponent(branch)}`,
        status: "RUNNING",
        version: branch,
        deployedAt: lastCommit ?? repo.pushed_at,
        rawConfig: { branch },
      });
    }
  }

  return instances;
}
