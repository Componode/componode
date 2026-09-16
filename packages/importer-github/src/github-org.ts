import type { Octokit } from "octokit";
import type { DiscoveredAsset } from "@componode/core";
import type { Logger } from "@componode/core";
import {
  withCapability,
  capabilityMarker,
  warnIfDegraded,
  type CapabilityMap,
} from "./capabilities.js";
import type { GithubConfig } from "./config.js";

interface GithubOrg {
  id: number;
  login: string;
  name?: string | null;
  html_url: string;
  description?: string | null;
  created_at?: string;
  is_verified?: boolean;
  plan?: {
    name: string;
    seats?: number;
    filled_seats?: number;
    private_repos?: number;
  };
  two_factor_requirement_enabled?: boolean | null;
  default_repository_permission?: string | null;
  members_can_create_repositories?: boolean | null;
  members_can_create_teams?: boolean;
  public_repos?: number;
  total_private_repos?: number;
  owned_private_repos?: number;
  disk_usage?: number | null;
  collaborators?: number | null;
}

interface GithubTeam {
  id: number;
  slug: string;
  name: string;
  members_count: number;
  repos_count: number;
  privacy?: string;
  parent?: { slug: string } | null;
}

export async function fetchOrganizationAsset(
  octokit: Octokit,
  config: GithubConfig,
  capabilities: CapabilityMap,
  signal: AbortSignal,
  logger: Logger,
): Promise<DiscoveredAsset> {
  const orgResult = await withCapability(() =>
    octokit.rest.orgs.get({ org: config.org, signal }),
  );
  capabilities.orgDetails = capabilityMarker(orgResult);
  warnIfDegraded(logger, "orgDetails", capabilities.orgDetails);
  const org = orgResult.status === "OK" ? (orgResult.data.data as GithubOrg) : undefined;

  const teamsResult = await withCapability(async () => {
    const teams: GithubTeam[] = [];
    for await (const { data } of octokit.paginate.iterator(
      octokit.rest.teams.list,
      { org: config.org, per_page: 100, signal },
    )) {
      teams.push(...(data as unknown as GithubTeam[]));
    }
    return teams;
  });
  capabilities.teams = capabilityMarker(teamsResult);
  warnIfDegraded(logger, "teams", capabilities.teams);

  const details: Record<string, unknown> = {};

  if (org) {
    details.profile = {
      login: org.login,
      htmlUrl: org.html_url,
      description: org.description ?? null,
      createdAt: org.created_at ?? null,
      isVerified: org.is_verified ?? null,
    };
    if (org.plan) {
      details.plan = {
        name: org.plan.name,
        seats: org.plan.seats ?? null,
        filledSeats: org.plan.filled_seats ?? null,
        privateRepos: org.plan.private_repos ?? null,
      };
    }
    details.policies = {
      twoFactorRequired: org.two_factor_requirement_enabled ?? null,
      defaultRepoPermission: org.default_repository_permission ?? null,
      membersCanCreateRepos: org.members_can_create_repositories ?? null,
      membersCanCreateTeams: org.members_can_create_teams ?? null,
    };
    details.usage = {
      publicRepos: org.public_repos ?? null,
      totalPrivateRepos: org.total_private_repos ?? null,
      ownedPrivateRepos: org.owned_private_repos ?? null,
      diskUsage: org.disk_usage ?? null,
      collaborators: org.collaborators ?? null,
    };
  }

  if (teamsResult.status === "OK" && teamsResult.data) {
    details.teams = teamsResult.data.map((t) => ({
      slug: t.slug,
      name: t.name,
      memberCount: t.members_count,
      reposCount: t.repos_count,
      privacy: t.privacy ?? null,
      parentSlug: t.parent?.slug ?? null,
    }));
  }

  details.capabilities = capabilities;

  return {
    category: "ACCOUNT",
    provider: "GITHUB",
    resourceType: "github:organization",
    name: org?.name ?? org?.login ?? config.org,
    externalId: org ? String(org.id) : `login:${config.org}`,
    slug: org?.login ?? config.org,
    details,
    instances: [],
  };
}
