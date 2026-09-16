import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GithubImporter } from "../src/importer.js";
import {
  NOOP_LOGGER,
  validateDiscoveredAssetDetailed,
  type ImporterContext,
} from "@componode/core";
import { mockFetch } from "./fetch-mock.js";

function makeContext(): ImporterContext {
  return {
    runId: "run-1",
    logger: NOOP_LOGGER,
    signal: new AbortController().signal,
    reportPhase: vi.fn(),
  };
}

function makeRepo(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 123,
    full_name: "testorg/repo",
    name: "repo",
    owner: { login: "testorg" },
    html_url: "https://github.com/testorg/repo",
    fork: false,
    archived: false,
    language: "TypeScript",
    topics: ["tag"],
    visibility: "public",
    default_branch: "main",
    updated_at: "2024-01-01T00:00:00Z",
    pushed_at: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeOrg(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 42,
    login: "testorg",
    name: "Test Org",
    html_url: "https://github.com/testorg",
    description: "Test organization",
    created_at: "2020-01-01T00:00:00Z",
    plan: { name: "team", seats: 10, filled_seats: 7, private_repos: 5 },
    two_factor_requirement_enabled: true,
    default_repository_permission: "read",
    members_can_create_repositories: true,
    members_can_create_teams: true,
    public_repos: 3,
    total_private_repos: 5,
    disk_usage: 100,
    collaborators: 2,
    ...overrides,
  };
}

function makeTeam(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 7,
    slug: "platform",
    name: "Platform",
    members_count: 5,
    repos_count: 3,
    privacy: "closed",
    parent: null,
    ...overrides,
  };
}

const BASE_ROUTES = [
  { path: "/orgs/testorg", body: makeOrg() },
  { path: "/orgs/testorg/teams", body: [makeTeam()] },
  { path: "/orgs/testorg/repos", body: [makeRepo()] },
];

async function collectAssets(importer: GithubImporter, config: Record<string, unknown>) {
  const assets = [];
  for await (const asset of importer.run(config, { token: "fake" }, makeContext())) {
    const result = validateDiscoveredAssetDetailed(asset);
    expect(result.errors ?? []).toEqual([]);
    assets.push(asset);
  }
  return assets;
}

describe("GithubImporter", () => {
  let fetchSpy: ReturnType<typeof mockFetch>;

  beforeEach(() => {
    fetchSpy = mockFetch(BASE_ROUTES);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("yields a DiscoveredAsset for each repository", async () => {
    const assets = await collectAssets(new GithubImporter(), { org: "testorg" });
    const repos = assets.filter((a) => a.resourceType === "github:repository");

    expect(repos).toHaveLength(1);
    expect(repos[0].category).toBe("REPOSITORY");
    expect(repos[0].provider).toBe("GITHUB");
  });

  it("filters forks when includeForks is false", async () => {
    fetchSpy.mockRestore();
    fetchSpy = mockFetch([
      { path: "/orgs/testorg", body: makeOrg() },
      { path: "/orgs/testorg/teams", body: [] },
      {
        path: "/orgs/testorg/repos",
        body: [
          makeRepo({ fork: true }),
          makeRepo({ id: 124, full_name: "testorg/regular", name: "regular" }),
        ],
      },
    ]);

    const assets = await collectAssets(new GithubImporter(), { org: "testorg" });
    const repos = assets.filter((a) => a.resourceType === "github:repository");

    expect(repos).toHaveLength(1);
    expect(repos[0].name).toBe("testorg/regular");
  });

  it("respects AbortSignal", async () => {
    const controller = new AbortController();
    controller.abort();

    const importer = new GithubImporter();
    const context: ImporterContext = {
      runId: "run-1",
      logger: NOOP_LOGGER,
      signal: controller.signal,
      reportPhase: vi.fn(),
    };

    const assets = [];
    for await (const asset of importer.run({ org: "testorg" }, { token: "fake" }, context)) {
      assets.push(asset);
    }

    expect(assets).toHaveLength(0);
  });

  // --- US1: organization as a catalog asset --------------------------------

  it("emits one ACCOUNT component for the organization", async () => {
    const assets = await collectAssets(new GithubImporter(), { org: "testorg" });
    const orgs = assets.filter((a) => a.resourceType === "github:organization");

    expect(orgs).toHaveLength(1);
    expect(orgs[0].category).toBe("ACCOUNT");
    expect(orgs[0].provider).toBe("GITHUB");
    expect(orgs[0].externalId).toBe("42");
    expect(orgs[0].slug).toBe("testorg");
    expect(orgs[0].name).toBe("Test Org");
    expect(orgs[0].instances).toHaveLength(0);
  });

  it("populates org details with plan, policies, usage, and teams", async () => {
    const assets = await collectAssets(new GithubImporter(), { org: "testorg" });
    const org = assets.find((a) => a.resourceType === "github:organization");

    const details = org?.details as Record<string, unknown>;
    expect(details.plan).toMatchObject({ name: "team", seats: 10, filledSeats: 7 });
    expect(details.policies).toMatchObject({ twoFactorRequired: true });
    expect(details.usage).toMatchObject({ publicRepos: 3, totalPrivateRepos: 5 });

    const teams = details.teams as Array<Record<string, unknown>>;
    expect(teams).toHaveLength(1);
    expect(teams[0]).toMatchObject({
      slug: "platform",
      name: "Platform",
      memberCount: 5,
      reposCount: 3,
      privacy: "closed",
    });
  });

  it("records FORBIDDEN marker when org details are denied", async () => {
    fetchSpy.mockRestore();
    fetchSpy = mockFetch([
      { path: "/orgs/testorg", status: 403, body: { message: "Forbidden" } },
      { path: "/orgs/testorg/teams", status: 403, body: { message: "Forbidden" } },
      { path: "/orgs/testorg/repos", body: [makeRepo()] },
    ]);

    const assets = await collectAssets(new GithubImporter(), { org: "testorg" });
    const org = assets.find((a) => a.resourceType === "github:organization");

    expect(org).toBeDefined();
    const capabilities = (org?.details as Record<string, unknown>).capabilities as Record<string, { status: string }>;
    expect(capabilities.orgDetails.status).toBe("FORBIDDEN");
  });

  it("skips the org component when includeOrganization is false", async () => {
    const assets = await collectAssets(new GithubImporter(), {
      org: "testorg",
      includeOrganization: false,
    });

    expect(assets.some((a) => a.resourceType === "github:organization")).toBe(false);
    expect(assets.some((a) => a.resourceType === "github:repository")).toBe(true);
  });

  // --- US2: real deployment topology ---------------------------------------

  function withDeploymentRoutes() {
    fetchSpy.mockRestore();
    fetchSpy = mockFetch([
      ...BASE_ROUTES,
      {
        path: "/repos/testorg/repo/environments",
        body: {
          total_count: 3,
          environments: [{ name: "prod" }, { name: "uat" }, { name: "canary" }],
        },
      },
      {
        path: "/repos/testorg/repo/deployments",
        query: { environment: "prod" },
        body: [{ id: 900, ref: "v1.2.3", created_at: "2024-06-01T00:00:00Z" }],
      },
      {
        path: "/repos/testorg/repo/deployments",
        query: { environment: "uat" },
        body: [],
      },
      {
        path: "/repos/testorg/repo/deployments",
        query: { environment: "canary" },
        body: [{ id: 901, ref: "v1.3.0-rc1", created_at: "2024-06-05T00:00:00Z" }],
      },
      {
        path: "/repos/testorg/repo/deployments/900/statuses",
        body: [{ state: "success" }],
      },
      {
        path: "/repos/testorg/repo/deployments/901/statuses",
        body: [{ state: "failure" }],
      },
      {
        path: "/repos/testorg/repo/releases/latest",
        body: { tag_name: "v1.2.3", published_at: "2024-05-30T00:00:00Z" },
      },
      {
        path: "/repos/testorg/repo/branches",
        body: [{ name: "main" }, { name: "develop" }, { name: "trunk" }],
      },
      {
        path: "/repos/testorg/repo/branches/main",
        body: {
          name: "main",
          commit: { commit: { committer: { date: "2024-07-01T00:00:00Z" } } },
        },
      },
      {
        path: "/repos/testorg/repo/branches/develop",
        body: {
          name: "develop",
          commit: { commit: { committer: { date: "2024-07-02T00:00:00Z" } } },
        },
      },
    ]);
  }

  it("uses the stable numeric repo id as externalId", async () => {
    const assets = await collectAssets(new GithubImporter(), { org: "testorg" });
    const repo = assets.find((a) => a.resourceType === "github:repository");

    expect(repo?.externalId).toBe("123");
  });

  it("emits branch instances only for mapped branches", async () => {
    withDeploymentRoutes();

    const assets = await collectAssets(new GithubImporter(), {
      org: "testorg",
      environmentMapping: { main: "PRODUCTION", develop: "DEV" },
    });
    const repo = assets.find((a) => a.resourceType === "github:repository");
    const branchInstances = (repo?.instances ?? []).filter((i) =>
      i.externalId.startsWith("branch:"),
    );

    expect(branchInstances).toHaveLength(2);
    expect(branchInstances.find((i) => i.externalId === "branch:main")).toMatchObject({
      environment: "PRODUCTION",
      status: "RUNNING",
      version: "main",
      deployedAt: "2024-07-01T00:00:00Z",
    });
    expect(branchInstances.find((i) => i.externalId === "branch:develop")).toMatchObject({
      environment: "DEV",
      deployedAt: "2024-07-02T00:00:00Z",
    });
  });

  it("emits environment instances with mapped classification and STOPPED when never deployed", async () => {
    withDeploymentRoutes();

    const assets = await collectAssets(new GithubImporter(), {
      org: "testorg",
      environmentMapping: {},
    });
    const repo = assets.find((a) => a.resourceType === "github:repository");
    const envInstances = (repo?.instances ?? []).filter((i) =>
      i.externalId.startsWith("env:"),
    );

    expect(envInstances).toHaveLength(3);
    expect(envInstances.find((i) => i.externalId === "env:prod")).toMatchObject({
      environment: "PRODUCTION",
      status: "RUNNING",
    });
    expect(envInstances.find((i) => i.externalId === "env:uat")).toMatchObject({
      environment: "OTHER",
      status: "STOPPED",
    });
  });

  it("derives version and deployedAt from deployment, then release, then branch", async () => {
    withDeploymentRoutes();

    const assets = await collectAssets(new GithubImporter(), {
      org: "testorg",
      environmentMapping: {},
    });
    const repo = assets.find((a) => a.resourceType === "github:repository");
    const envs = (repo?.instances ?? []).filter((i) => i.externalId.startsWith("env:"));

    expect(envs.find((i) => i.externalId === "env:prod")).toMatchObject({
      status: "RUNNING",
      version: "v1.2.3",
      deployedAt: "2024-06-01T00:00:00Z",
    });
    expect(envs.find((i) => i.externalId === "env:canary")).toMatchObject({
      status: "ERROR",
      version: "v1.3.0-rc1",
      deployedAt: "2024-06-05T00:00:00Z",
    });
    expect(envs.find((i) => i.externalId === "env:uat")).toMatchObject({
      status: "STOPPED",
      version: "v1.2.3",
      deployedAt: "2024-05-30T00:00:00Z",
    });
  });

  it("respects includeEnvironments and includeReleases toggles", async () => {
    withDeploymentRoutes();

    const assets = await collectAssets(new GithubImporter(), {
      org: "testorg",
      includeEnvironments: false,
      includeReleases: false,
    });
    const repo = assets.find((a) => a.resourceType === "github:repository");

    expect((repo?.instances ?? []).some((i) => i.externalId.startsWith("env:"))).toBe(false);
  });

  // --- US3: cost & usage visibility ------------------------------------------

  function withBillingRoutes(overrides: { usageStatus?: number } = {}) {
    fetchSpy.mockRestore();
    fetchSpy = mockFetch([
      ...BASE_ROUTES,
      { path: "/repos/testorg/repo/environments", status: 404, body: { message: "Not Found" } },
      { path: "/repos/testorg/repo/branches", body: [] },
      {
        path: "/orgs/testorg/settings/billing/actions",
        body: { total_minutes_used: 4200, included_minutes: 3000 },
      },
      {
        path: "/orgs/testorg/settings/billing/packages",
        body: { total_gigabytes_bandwidth_used: 12, included_gigabytes_bandwidth: 2 },
      },
      {
        path: "/orgs/testorg/settings/billing/shared-storage",
        body: { days_left_in_billing_cycle: 10, estimated_paid_storage_for_month: 5, estimated_storage_for_month: 20 },
      },
      {
        path: "/organizations/testorg/settings/billing/usage",
        status: overrides.usageStatus ?? 200,
        body: {
          usageItems: [
            { date: "2026-09-01", product: "actions", sku: "linux", quantity: 100, unitType: "minutes", pricePerUnit: 0.008, grossAmount: 8, discountAmount: 0, netAmount: 8, organizationName: "testorg", repositoryName: "testorg/repo" },
            { date: "2026-09-02", product: "actions", sku: "linux", quantity: 50, unitType: "minutes", pricePerUnit: 0.008, grossAmount: 4, discountAmount: 1, netAmount: 3, organizationName: "testorg", repositoryName: "testorg/repo" },
            { date: "2026-09-02", product: "copilot", sku: "premium", quantity: 10, unitType: "requests", pricePerUnit: 0.04, grossAmount: 0.4, discountAmount: 0, netAmount: 0.4, organizationName: "testorg", repositoryName: "testorg/other" },
          ],
        },
      },
      {
        path: "/organizations/testorg/settings/billing/ai_credit/usage",
        body: { usageItems: [{ product: "copilot", sku: "ai-credit", model: "gpt", unitType: "credits", pricePerUnit: 1, grossQuantity: 5, grossAmount: 5, discountQuantity: 0, discountAmount: 0, netQuantity: 5, netAmount: 5 }] },
      },
      {
        path: "/organizations/testorg/settings/billing/premium_request/usage",
        status: 404,
        body: { message: "Not Found" },
      },
    ]);
  }

  it("aggregates billing usage into the org component details", async () => {
    withBillingRoutes();

    const assets = await collectAssets(new GithubImporter(), { org: "testorg" });
    const org = assets.find((a) => a.resourceType === "github:organization");
    const billing = (org?.details as Record<string, unknown>).billing as Record<string, unknown>;

    expect(billing.status).toBe("OK");
    expect(billing.totals).toMatchObject({ grossAmount: 12.4, netAmount: 11.4 });
    const byProduct = billing.byProduct as Array<Record<string, unknown>>;
    expect(byProduct.find((p) => p.product === "actions")).toMatchObject({ netAmount: 11 });
    const topRepos = billing.topRepos as Array<Record<string, unknown>>;
    expect(topRepos[0]).toMatchObject({ repository: "testorg/repo", netAmount: 11 });
    expect((billing.premiumRequests as Record<string, unknown>).status).toBe("UNAVAILABLE");
    expect((billing.aiCredits as Record<string, unknown>).netAmount).toBe(5);
    expect(billing.actionsMinutes).toMatchObject({ includedMinutes: 3000 });
  });

  it("attributes billing usage to repository components", async () => {
    withBillingRoutes();

    const assets = await collectAssets(new GithubImporter(), { org: "testorg" });
    const repo = assets.find((a) => a.resourceType === "github:repository");
    const repoBilling = (repo?.details as Record<string, unknown>).billing as Record<string, unknown>;

    expect(repoBilling.netAmount).toBe(11);
    const byProduct = repoBilling.byProduct as Array<Record<string, unknown>>;
    expect(byProduct[0]).toMatchObject({ product: "actions", netAmount: 11 });
  });

  it("marks billing FORBIDDEN on 403 and still completes the run", async () => {
    withBillingRoutes({ usageStatus: 403 });

    const assets = await collectAssets(new GithubImporter(), { org: "testorg" });
    const org = assets.find((a) => a.resourceType === "github:organization");
    const billing = (org?.details as Record<string, unknown>).billing as Record<string, unknown>;

    expect(billing.status).toBe("FORBIDDEN");
    expect(assets.some((a) => a.resourceType === "github:repository")).toBe(true);
  });

  it("skips billing calls entirely when includeBilling is false", async () => {
    withBillingRoutes();

    await collectAssets(new GithubImporter(), { org: "testorg", includeBilling: false });

    const calledPaths = fetchSpy.mock.calls.map((c) => new URL(String(c[0])).pathname);
    expect(calledPaths.some((p) => p.includes("/settings/billing"))).toBe(false);
  });

  it("requests the previous calendar month when billingPeriod is previous", async () => {
    withBillingRoutes();

    await collectAssets(new GithubImporter(), { org: "testorg", billingPeriod: "previous" });

    const now = new Date();
    const prevYear = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
    const prevMonth = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth();

    const usageCall = fetchSpy.mock.calls.find((c) =>
      String(c[0]).includes("billing/usage"),
    );
    const url = new URL(String(usageCall?.[0]));
    expect(Number(url.searchParams.get("year"))).toBe(prevYear);
    expect(Number(url.searchParams.get("month"))).toBe(prevMonth);
  });

  // --- US4: workflows, runners, packages, GHES, rate limits --------------------

  const PACKAGE_TYPES = ["container", "npm", "maven", "nuget", "rubygems", "docker"];

  function withExtrasRoutes() {
    fetchSpy.mockRestore();
    fetchSpy = mockFetch([
      ...BASE_ROUTES,
      { path: "/repos/testorg/repo/environments", status: 404, body: { message: "Not Found" } },
      { path: "/repos/testorg/repo/branches", body: [] },
      {
        path: "/repos/testorg/repo/actions/workflows",
        body: {
          total_count: 1,
          workflows: [
            {
              id: 77,
              name: "CI",
              path: ".github/workflows/ci.yml",
              state: "active",
              badge_url: "https://github.com/testorg/repo/workflows/CI/badge.svg",
            },
          ],
        },
      },
      {
        path: "/orgs/testorg/actions/runners",
        body: {
          total_count: 1,
          runners: [
            {
              id: 501,
              name: "runner-1",
              os: "linux",
              status: "online",
              busy: false,
              runner_group_id: 2,
              labels: [{ name: "self-hosted" }, { name: "linux" }],
            },
          ],
        },
      },
      ...PACKAGE_TYPES.map((t) => ({
        path: "/orgs/testorg/packages",
        query: { package_type: t },
        body:
          t === "container"
            ? [
                {
                  id: 601,
                  name: "my-image",
                  package_type: "container",
                  visibility: "public",
                  html_url: "https://github.com/orgs/testorg/packages/container/my-image",
                  owner: { login: "testorg" },
                },
              ]
            : [],
      })),
      {
        path: "/rate_limit",
        body: { resources: { core: { limit: 5000, remaining: 4900, used: 100 } } },
      },
    ]);
  }

  it("emits workflow JOB components only when includeWorkflows is set", async () => {
    withExtrasRoutes();

    const without = await collectAssets(new GithubImporter(), { org: "testorg" });
    expect(without.some((a) => a.resourceType === "github:workflow")).toBe(false);

    const assets = await collectAssets(new GithubImporter(), {
      org: "testorg",
      includeWorkflows: true,
    });
    const workflow = assets.find((a) => a.resourceType === "github:workflow");

    expect(workflow).toMatchObject({
      category: "JOB",
      provider: "GITHUB",
      name: "testorg/repo / CI",
      externalId: "123:77",
      instances: [],
    });
    expect(workflow?.details).toMatchObject({
      path: ".github/workflows/ci.yml",
      state: "active",
      repoFullName: "testorg/repo",
    });
  });

  it("emits runner COMPUTE components when includeRunners is set", async () => {
    withExtrasRoutes();

    const assets = await collectAssets(new GithubImporter(), {
      org: "testorg",
      includeRunners: true,
    });
    const runner = assets.find((a) => a.resourceType === "github:runner");

    expect(runner).toMatchObject({
      category: "COMPUTE",
      provider: "GITHUB",
      name: "runner-1",
      externalId: "501",
      instances: [],
    });
    expect(runner?.details).toMatchObject({ os: "linux", status: "online", busy: false });
    expect((runner?.details as Record<string, unknown>).labels).toContain("linux");

    const org = assets.find((a) => a.resourceType === "github:organization");
    const caps = (org?.details as Record<string, unknown>).capabilities as Record<
      string,
      { status: string }
    >;
    expect(caps.runners.status).toBe("OK");
  });

  it("emits package PACKAGE_REGISTRY components across package types when includePackages is set", async () => {
    withExtrasRoutes();

    const assets = await collectAssets(new GithubImporter(), {
      org: "testorg",
      includePackages: true,
    });
    const pkg = assets.find((a) => a.resourceType === "github:package");

    expect(pkg).toMatchObject({
      category: "PACKAGE_REGISTRY",
      provider: "GITHUB",
      name: "container:my-image",
      externalId: "601",
      instances: [],
    });
    expect(pkg?.details).toMatchObject({ packageType: "container", visibility: "public" });

    const packageCalls = fetchSpy.mock.calls.filter((c) =>
      String(c[0]).includes("/orgs/testorg/packages"),
    );
    expect(packageCalls.length).toBe(PACKAGE_TYPES.length);
  });

  it("targets the configured GHES baseUrl for all requests", async () => {
    withExtrasRoutes();

    await collectAssets(new GithubImporter(), {
      org: "testorg",
      baseUrl: "https://ghes.example.com/api/v3",
    });

    const hosts = fetchSpy.mock.calls.map((c) => new URL(String(c[0])).host);
    expect(hosts.length).toBeGreaterThan(0);
    expect(hosts.every((h) => h === "ghes.example.com")).toBe(true);
  });

  it("rejects unsafe baseUrl values at config validation", async () => {
    for (const baseUrl of [
      "https://localhost/api/v3",
      "https://192.168.1.1/api/v3",
      "http://ghes.example.com/api/v3",
      "ftp://ghes.example.com",
      "not-a-url",
    ]) {
      await expect(
        collectAssets(new GithubImporter(), { org: "testorg", baseUrl }),
      ).rejects.toThrow();
    }
  });

  it("logs rate-limit telemetry after the run", async () => {
    withExtrasRoutes();

    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child() {
        return this;
      },
    };
    const context: ImporterContext = {
      runId: "run-1",
      logger,
      signal: new AbortController().signal,
      reportPhase: vi.fn(),
    };

    const assets = [];
    for await (const asset of new GithubImporter().run(
      { org: "testorg" },
      { token: "fake" },
      context,
    )) {
      assets.push(asset);
    }

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("rate limit"),
      expect.objectContaining({ limit: 5000, remaining: 4900 }),
    );
  });
});
