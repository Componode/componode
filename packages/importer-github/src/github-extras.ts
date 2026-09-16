import type { Octokit } from "octokit";
import type { DiscoveredAsset } from "@componode/core";
import { withCapability } from "./capabilities.js";

const PACKAGE_TYPES = ["container", "npm", "maven", "nuget", "rubygems", "docker"] as const;

interface GithubWorkflow {
  id: number;
  name: string;
  path: string;
  state: string;
  badge_url?: string | null;
}

interface GithubRunner {
  id: number;
  name: string;
  os: string;
  status: string;
  busy: boolean;
  runner_group_id?: number | null;
  labels?: { name: string }[];
}

interface GithubPackage {
  id: number;
  name: string;
  package_type: string;
  visibility?: string;
  html_url?: string;
  owner?: { login: string };
}

export async function* fetchWorkflowAssets(
  octokit: Octokit,
  repo: { id: number; full_name: string; owner: { login: string }; name: string },
  signal: AbortSignal,
): AsyncGenerator<DiscoveredAsset> {
  for await (const { data } of octokit.paginate.iterator(
    octokit.rest.actions.listRepoWorkflows,
    { owner: repo.owner.login, repo: repo.name, per_page: 100, signal },
  )) {
    if (signal.aborted) return;
    for (const workflow of data as GithubWorkflow[]) {
      yield {
        category: "JOB",
        provider: "GITHUB",
        resourceType: "github:workflow",
        name: `${repo.full_name} / ${workflow.name}`,
        externalId: `${repo.id}:${workflow.id}`,
        slug: `${repo.name}-${workflow.id}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
        details: {
          path: workflow.path,
          state: workflow.state,
          badgeUrl: workflow.badge_url ?? null,
          repoFullName: repo.full_name,
        },
        instances: [],
      };
    }
  }
}

export async function* fetchRunnerAssets(
  octokit: Octokit,
  org: string,
  signal: AbortSignal,
): AsyncGenerator<DiscoveredAsset> {
  const runners: GithubRunner[] = [];
  let page = 1;
  let totalCount: number | undefined;
  do {
    const { data } = await octokit.rest.actions.listSelfHostedRunnersForOrg({
      org,
      per_page: 100,
      page,
      signal,
    });
    runners.push(...((data as { runners?: GithubRunner[] }).runners ?? []));
    totalCount = (data as { total_count?: number }).total_count;
    page += 1;
    if (signal.aborted) return;
  } while (totalCount !== undefined && runners.length < totalCount);

  for (const runner of runners) {
    yield {
      category: "COMPUTE",
      provider: "GITHUB",
      resourceType: "github:runner",
      name: runner.name,
      externalId: String(runner.id),
      slug: `runner-${runner.id}`,
      details: {
        os: runner.os,
        status: runner.status,
        busy: runner.busy,
        runnerGroupId: runner.runner_group_id ?? null,
        labels: (runner.labels ?? []).map((l) => l.name),
      },
      instances: [],
    };
  }
}

export async function* fetchPackageAssets(
  octokit: Octokit,
  org: string,
  signal: AbortSignal,
): AsyncGenerator<DiscoveredAsset> {
  for (const packageType of PACKAGE_TYPES) {
    if (signal.aborted) return;

    const result = await withCapability(() =>
      octokit.rest.packages.listPackagesForOrganization({
        org,
        package_type: packageType,
        per_page: 100,
        signal,
      }),
    );
    if (result.status !== "OK" || !result.data) continue;

    for (const pkg of result.data.data as GithubPackage[]) {
      yield {
        category: "PACKAGE_REGISTRY",
        provider: "GITHUB",
        resourceType: "github:package",
        name: `${pkg.package_type}:${pkg.name}`,
        externalId: String(pkg.id),
        slug: `${packageType}-${pkg.id}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        details: {
          packageType: pkg.package_type,
          visibility: pkg.visibility ?? null,
          htmlUrl: pkg.html_url ?? null,
          owner: pkg.owner?.login ?? null,
        },
        instances: [],
      };
    }
  }
}
