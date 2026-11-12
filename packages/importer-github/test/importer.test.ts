import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GithubImporter } from "../src/importer.js";
import {
  NOOP_LOGGER,
  validateDiscoveredAssetDetailed,
  type ImporterContext,
} from "@componode/core";
import { mockFetch, nextPageLink, type MockRoute } from "./fetch-mock.js";

function makeContext(): ImporterContext {
  return {
    runId: "run-1",
    logger: NOOP_LOGGER,
    signal: new AbortController().signal,
    reportPhase: vi.fn(),
    reportSourceIdentity: vi.fn(),
    resolveTarget: vi.fn(),
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
      reportSourceIdentity: vi.fn(),
      resolveTarget: vi.fn(),
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
      { path: "/orgs/testorg", body: makeOrg() },
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

  it("emits workflow JOB components only when includeWorkflows is set", { timeout: 15000 }, async () => {
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

  it("reports org-id source identity; qualifies externalIds only on GHES", { timeout: 30000 }, async () => {
    withExtrasRoutes();

    // github.com: unqualified IDs, identity = api.github.com#org:{id}.
    const ctx1 = makeContext();
    const com = [];
    for await (const a of new GithubImporter().run({ org: "testorg" }, { token: "fake" }, ctx1)) {
      com.push(a);
    }
    expect(ctx1.reportSourceIdentity).toHaveBeenCalledWith(
      expect.objectContaining({ externalIdentity: "https://api.github.com/org/42" }),
    );
    const comRepo = com.find((a) => a.resourceType === "github:repository");
    expect(comRepo.externalId).toBe("123");

    // GHES: numeric IDs collide across instances — qualified by identity.
    const ctx2 = makeContext();
    const ghes = [];
    for await (const a of new GithubImporter().run(
      { org: "testorg", baseUrl: "https://ghes.example.com/api/v3" },
      { token: "fake" },
      ctx2,
    )) {
      ghes.push(a);
    }
    expect(ctx2.reportSourceIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        externalIdentity: "https://ghes.example.com/api/v3/org/42",
      }),
    );
    const ghesRepo = ghes.find((a) => a.resourceType === "github:repository");
    expect(ghesRepo.externalId).toBe("https://ghes.example.com/api/v3/org/42::123");
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
      reportSourceIdentity: vi.fn(),
      resolveTarget: vi.fn(),
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

  // --- spec 072: branch/version inventory, repo metadata, governance --------

  function makeBranchItem(name: string, sha: string, isProtected = false) {
    return {
      name,
      commit: {
        sha,
        url: `https://api.github.com/repos/testorg/repo/commits/${sha}`,
      },
      protected: isProtected,
    };
  }

  function makeBranchDetail(name: string, sha: string, date: string) {
    return {
      name,
      commit: {
        sha,
        commit: { committer: { date } },
      },
    };
  }

  function makeReleaseItem(overrides: Record<string, unknown> = {}) {
    return {
      id: 7300,
      tag_name: "v1.0.0",
      name: "v1.0.0",
      draft: false,
      prerelease: false,
      target_commitish: "main",
      published_at: "2026-01-03T00:00:00Z",
      html_url: "https://github.com/testorg/repo/releases/tag/v1.0.0",
      assets: [
        { name: "repo-1.0.0.zip", size: 1024 },
        { name: "checksums.txt", size: 256 },
      ],
      ...overrides,
    };
  }

  function makeTagItem(name: string, sha: string) {
    return {
      name,
      commit: {
        sha,
        url: `https://api.github.com/repos/testorg/repo/commits/${sha}`,
      },
    };
  }

  const SHA_MAIN = "aaaa000000000000000000000000000000000001";
  const SHA_DEVELOP = "bbbb000000000000000000000000000000000002";
  const SHA_FEATURE = "cccc000000000000000000000000000000000003";
  const SHA_DEPENDABOT = "dddd000000000000000000000000000000000004";

  const INVENTORY_BRANCHES = [
    makeBranchItem("main", SHA_MAIN, true),
    makeBranchItem("develop", SHA_DEVELOP),
    makeBranchItem("feature/checkout", SHA_FEATURE),
    makeBranchItem("dependabot/npm/lodash", SHA_DEPENDABOT, true),
  ];

  // Standard inventory fixture for testorg/repo: every branch, empty
  // environments, empty releases/tags. `extra` routes take precedence over
  // the standards (registered first) for failure-injection overrides.
  function inventoryRoutes(extra: MockRoute[] = []): MockRoute[] {
    return [
      ...extra,
      ...BASE_ROUTES,
      {
        path: "/repos/testorg/repo/environments",
        body: { total_count: 0, environments: [] },
      },
      { path: "/repos/testorg/repo/branches", body: INVENTORY_BRANCHES },
      {
        path: "/repos/testorg/repo/branches/develop",
        body: makeBranchDetail("develop", SHA_DEVELOP, "2026-02-01T00:00:00Z"),
      },
      { path: "/repos/testorg/repo/releases", body: [] },
      { path: "/repos/testorg/repo/tags", body: [] },
    ];
  }

  function useRoutes(routes: MockRoute[]) {
    fetchSpy.mockRestore();
    fetchSpy = mockFetch(routes);
  }

  function repoAsset(assets: Awaited<ReturnType<typeof collectAssets>>) {
    return assets.find((a) => a.resourceType === "github:repository");
  }

  function orgAsset(assets: Awaited<ReturnType<typeof collectAssets>>) {
    return assets.find((a) => a.resourceType === "github:organization");
  }

  function detailsOf(asset: { details?: unknown } | undefined) {
    return (asset?.details ?? {}) as Record<string, unknown>;
  }

  function capsOf(asset: { details?: unknown } | undefined) {
    return (detailsOf(asset).capabilities ?? {}) as Record<
      string,
      { status: string; message?: string }
    >;
  }

  // US1 — T011

  it("emits every branch in details.branches alongside mapped branch instances", async () => {
    useRoutes(inventoryRoutes());

    const assets = await collectAssets(new GithubImporter(), { org: "testorg" });
    const repo = repoAsset(assets);
    const branches = detailsOf(repo).branches as Array<Record<string, unknown>>;

    expect(branches.map((b) => b.name).sort()).toEqual([
      "dependabot/npm/lodash",
      "develop",
      "feature/checkout",
      "main",
    ]);

    const main = branches.find((b) => b.name === "main");
    expect(main).toMatchObject({
      sha: SHA_MAIN,
      protected: true,
      isDefault: true,
    });
    expect(main?.url).toContain("/tree/main");
    expect(main?.lastActivityAt).toBeUndefined();

    const develop = branches.find((b) => b.name === "develop");
    expect(develop).toMatchObject({ sha: SHA_DEVELOP, isDefault: false });
    const feature = branches.find((b) => b.name === "feature/checkout");
    expect(feature?.sha).toBe(SHA_FEATURE);
    const dependabot = branches.find((b) => b.name === "dependabot/npm/lodash");
    expect(dependabot).toMatchObject({ sha: SHA_DEPENDABOT, protected: true });

    // Spec-011 coexistence: only mapping-classified branches emit instances.
    const externalIds = (repo?.instances ?? []).map((i) => i.externalId);
    expect(externalIds).toContain("branch:develop");
    expect(externalIds).not.toContain("branch:main");
    expect(externalIds).not.toContain("branch:feature/checkout");
    expect(externalIds).not.toContain("branch:dependabot/npm/lodash");
    expect(capsOf(repo).branches?.status).toBe("OK");
  });

  it("omits details.branches when includeBranchInventory is false but keeps branch instances", async () => {
    useRoutes(inventoryRoutes());

    const assets = await collectAssets(new GithubImporter(), {
      org: "testorg",
      includeBranchInventory: false,
    });
    const repo = repoAsset(assets);

    expect(detailsOf(repo).branches).toBeUndefined();
    const externalIds = (repo?.instances ?? []).map((i) => i.externalId);
    expect(externalIds).toContain("branch:develop");
  });

  it("suppresses branch instances when includeBranchInstances is false but keeps inventory", async () => {
    useRoutes(inventoryRoutes());

    const assets = await collectAssets(new GithubImporter(), {
      org: "testorg",
      includeBranchInstances: false,
    });
    const repo = repoAsset(assets);

    const branches = detailsOf(repo).branches as Array<Record<string, unknown>>;
    expect(branches).toHaveLength(4);
    const externalIds = (repo?.instances ?? []).map((i) => i.externalId);
    expect(externalIds.some((id) => id.startsWith("branch:"))).toBe(false);
  });

  it("skips the branches call entirely when both branch toggles are off", async () => {
    useRoutes(inventoryRoutes());

    await collectAssets(new GithubImporter(), {
      org: "testorg",
      includeBranchInventory: false,
      includeBranchInstances: false,
    });

    const branchCalls = fetchSpy.mock.calls.filter((c) =>
      /\/repos\/testorg\/repo\/branches/.test(new URL(String(c[0])).pathname),
    );
    expect(branchCalls).toHaveLength(0);
  });

  it("adds lastActivityAt per branch when includeBranchActivity is on, deduped with the instance path", async () => {
    useRoutes([
      ...inventoryRoutes(),
      {
        path: "/repos/testorg/repo/branches/main",
        body: makeBranchDetail("main", SHA_MAIN, "2026-02-04T00:00:00Z"),
      },
      {
        path: "/repos/testorg/repo/branches/feature%2Fcheckout",
        body: makeBranchDetail("feature/checkout", SHA_FEATURE, "2026-02-03T00:00:00Z"),
      },
      {
        path: "/repos/testorg/repo/branches/dependabot%2Fnpm%2Flodash",
        body: makeBranchDetail("dependabot/npm/lodash", SHA_DEPENDABOT, "2026-02-02T00:00:00Z"),
      },
    ]);

    const assets = await collectAssets(new GithubImporter(), {
      org: "testorg",
      includeBranchActivity: true,
    });
    const repo = repoAsset(assets);
    const branches = detailsOf(repo).branches as Array<Record<string, unknown>>;

    expect(branches.find((b) => b.name === "main")?.lastActivityAt).toBe(
      "2026-02-04T00:00:00Z",
    );
    expect(branches.find((b) => b.name === "develop")?.lastActivityAt).toBe(
      "2026-02-01T00:00:00Z",
    );
    expect(branches.find((b) => b.name === "feature/checkout")?.lastActivityAt).toBe(
      "2026-02-03T00:00:00Z",
    );
    expect(
      branches.find((b) => b.name === "dependabot/npm/lodash")?.lastActivityAt,
    ).toBe("2026-02-02T00:00:00Z");
    expect(capsOf(repo).branchActivity?.status).toBe("OK");

    // One getBranch call per branch — `develop` is shared between the
    // instance path and the activity lookup (no duplicate API call).
    const detailCalls = fetchSpy.mock.calls.filter((c) => {
      const p = new URL(String(c[0])).pathname;
      return /^\/repos\/testorg\/repo\/branches\/[^/]+/.test(p);
    });
    expect(detailCalls).toHaveLength(4);
  });

  it("records FORBIDDEN capability markers and completes when /branches fails", async () => {
    useRoutes(
      inventoryRoutes([
        {
          path: "/repos/testorg/repo/branches",
          status: 403,
          body: { message: "Forbidden" },
        },
      ]),
    );

    const assets = await collectAssets(new GithubImporter(), { org: "testorg" });
    const repo = repoAsset(assets);

    expect(repo).toBeDefined();
    expect(detailsOf(repo).branches).toBeUndefined();
    expect(capsOf(repo).branches?.status).toBe("FORBIDDEN");
    expect(capsOf(repo).branchInstances?.status).toBe("FORBIDDEN");
    expect(capsOf(orgAsset(assets)).branches?.status).toBe("FORBIDDEN");
    expect(capsOf(orgAsset(assets)).branchInstances?.status).toBe("FORBIDDEN");
    // No branch instances can be classified without the branch list.
    expect(
      (repo?.instances ?? []).some((i) => i.externalId.startsWith("branch:")),
    ).toBe(false);
  });

  // US2 — T017

  function versionRoutes(): MockRoute[] {
    const releasesPage1 = [
      makeReleaseItem({
        id: 7302,
        tag_name: "v2.0.0-draft",
        name: "v2.0.0 (draft)",
        draft: true,
        published_at: null,
        html_url: "https://github.com/testorg/repo/releases/tag/v2.0.0-draft",
        assets: [],
      }),
      makeReleaseItem({
        id: 7301,
        tag_name: "v1.1.0-rc.1",
        name: "v1.1.0 release candidate",
        prerelease: true,
        target_commitish: "develop",
        published_at: "2026-01-04T00:00:00Z",
        html_url: "https://github.com/testorg/repo/releases/tag/v1.1.0-rc.1",
        assets: [{ name: "rc.zip", size: 2048 }],
      }),
    ];
    const releasesPage2 = [
      makeReleaseItem({ id: 7300, tag_name: "v1.0.0", name: "v1.0.0" }),
    ];
    const tagsPage1 = [
      makeTagItem("nightly", "eeee000000000000000000000000000000000005"),
      makeTagItem("v1.0.0", "ffff000000000000000000000000000000000006"),
    ];
    const tagsPage2 = [
      makeTagItem("legacy-2025", "99990000000000000000000000000000000007"),
    ];
    return inventoryRoutes([
      {
        path: "/repos/testorg/repo/releases",
        query: { page: "2" },
        body: releasesPage2,
      },
      {
        path: "/repos/testorg/repo/releases",
        headers: {
          link: nextPageLink(
            "https://api.github.com/repos/testorg/repo/releases?page=2&per_page=100",
          ),
        },
        body: releasesPage1,
      },
      {
        path: "/repos/testorg/repo/tags",
        query: { page: "2" },
        body: tagsPage2,
      },
      {
        path: "/repos/testorg/repo/tags",
        headers: {
          link: nextPageLink(
            "https://api.github.com/repos/testorg/repo/tags?page=2&per_page=100",
          ),
        },
        body: tagsPage1,
      },
    ]);
  }

  it("emits fully paginated releases and tags inventories", async () => {
    useRoutes(versionRoutes());

    const assets = await collectAssets(new GithubImporter(), { org: "testorg" });
    const repo = repoAsset(assets);
    const details = detailsOf(repo);

    const releases = details.releases as Array<Record<string, unknown>>;
    expect(releases).toHaveLength(3);
    const byTag = new Map(releases.map((r) => [r.tagName, r]));
    const v100 = byTag.get("v1.0.0");
    expect(v100).toMatchObject({
      id: 7300,
      draft: false,
      prerelease: false,
      targetCommitish: "main",
      assetCount: 2,
      assetsTotalBytes: 1280,
      publishedAt: "2026-01-03T00:00:00Z",
    });
    expect(v100?.htmlUrl).toContain("/releases/tag/v1.0.0");
    expect(byTag.get("v1.1.0-rc.1")).toMatchObject({
      prerelease: true,
      assetCount: 1,
      assetsTotalBytes: 2048,
    });
    expect(byTag.get("v2.0.0-draft")).toMatchObject({ draft: true });

    const tags = details.tags as Array<Record<string, unknown>>;
    // FR-007: tags[] carries plain tags lacking releases — v1.0.0 backs a
    // release so it appears only under releases[].
    expect(tags.map((t) => t.name).sort()).toEqual([
      "legacy-2025",
      "nightly",
    ]);
    expect(tags.find((t) => t.name === "nightly")).toMatchObject({
      sha: "eeee000000000000000000000000000000000005",
    });
    expect(tags.find((t) => t.name === "nightly")?.htmlUrl).toContain(
      "/releases/tag/nightly",
    );

    expect(capsOf(repo).versionInventory?.status).toBe("OK");
  });

  it("keeps the includeReleases env fallback when includeReleaseInventory is off", async () => {
    useRoutes(
      inventoryRoutes([
        {
          path: "/repos/testorg/repo/environments",
          body: {
            total_count: 1,
            environments: [{ name: "prod" }],
          },
        },
        {
          path: "/repos/testorg/repo/deployments",
          query: { environment: "prod" },
          body: [{ id: 900 }],
        },
        {
          path: "/repos/testorg/repo/deployments/900/statuses",
          body: [{ state: "success" }],
        },
        {
          path: "/repos/testorg/repo/releases/latest",
          body: { tag_name: "v9.9.9", published_at: "2026-02-01T00:00:00Z" },
        },
      ]),
    );

    const assets = await collectAssets(new GithubImporter(), {
      org: "testorg",
      includeReleaseInventory: false,
    });
    const repo = repoAsset(assets);
    const details = detailsOf(repo);

    expect(details.releases).toBeUndefined();
    expect(details.tags).toBeUndefined();

    const env = (repo?.instances ?? []).find((i) => i.externalId === "env:prod");
    expect(env).toMatchObject({
      environment: "PRODUCTION",
      version: "v9.9.9",
      deployedAt: "2026-02-01T00:00:00Z",
    });
    // The latest-release fallback was exercised → releases marker recorded.
    expect(capsOf(repo).releases?.status).toBe("OK");
  });

  it("marks versionInventory degraded and still emits tags when /releases fails", async () => {
    useRoutes(
      inventoryRoutes([
        {
          path: "/repos/testorg/repo/releases",
          status: 403,
          body: { message: "Forbidden" },
        },
        {
          path: "/repos/testorg/repo/tags",
          body: [makeTagItem("nightly", "eeee000000000000000000000000000000000005")],
        },
      ]),
    );

    const assets = await collectAssets(new GithubImporter(), { org: "testorg" });
    const repo = repoAsset(assets);
    const details = detailsOf(repo);

    expect(details.releases).toBeUndefined();
    expect((details.tags as unknown[]).length).toBe(1);
    expect(capsOf(repo).versionInventory?.status).toBe("FORBIDDEN");
    expect(capsOf(orgAsset(assets)).versionInventory?.status).toBe("FORBIDDEN");
  });

  // US3 — T021

  it("emits repo metadata scalars and fork/license fields on details", async () => {
    useRoutes(
      inventoryRoutes([
        {
          path: "/orgs/testorg/repos",
          body: [
            makeRepo({
              parent: null,
              source: null,
              size: 2048,
              license: {
                key: "apache-2.0",
                name: "Apache License 2.0",
                spdx_id: "Apache-2.0",
              },
              open_issues_count: 7,
              created_at: "2025-06-01T00:00:00Z",
              disabled: false,
            }),
          ],
        },
      ]),
    );

    const assets = await collectAssets(new GithubImporter(), { org: "testorg" });
    const details = detailsOf(repoAsset(assets));

    expect(details.defaultBranch).toBe("main");
    expect(details.archived).toBe(false);
    expect(details.disabled).toBe(false);
    expect(details.fork).toBe(false);
    expect(details.forkParent).toBeNull();
    expect(details.forkSource).toBeNull();
    expect(details.sizeKb).toBe(2048);
    expect(details.license).toMatchObject({
      key: "apache-2.0",
      name: "Apache License 2.0",
      spdxId: "Apache-2.0",
    });
    expect(details.openIssuesCount).toBe(7);
    expect(details.createdAt).toBe("2025-06-01T00:00:00Z");
    expect(details.pushedAt).toBe("2024-01-01T00:00:00Z");
    expect(details.updatedAt).toBe("2024-01-01T00:00:00Z");
  });

  it("surfaces fork provenance when the repo is a fork", async () => {
    useRoutes(
      inventoryRoutes([
        {
          path: "/orgs/testorg/repos",
          body: [
            makeRepo({
              id: 321,
              full_name: "testorg/forked",
              name: "forked",
              fork: true,
              parent: {
                full_name: "upstream/original",
                html_url: "https://github.com/upstream/original",
              },
              source: {
                full_name: "upstream/root",
                html_url: "https://github.com/upstream/root",
              },
            }),
          ],
        },
        {
          path: "/repos/testorg/forked/environments",
          body: { total_count: 0, environments: [] },
        },
        { path: "/repos/testorg/forked/branches", body: [] },
        { path: "/repos/testorg/forked/releases", body: [] },
        { path: "/repos/testorg/forked/tags", body: [] },
      ]),
    );

    const assets = await collectAssets(new GithubImporter(), {
      org: "testorg",
      includeForks: true,
    });
    const details = detailsOf(repoAsset(assets));

    expect(details.fork).toBe(true);
    expect(details.forkParent).toEqual({
      fullName: "upstream/original",
      htmlUrl: "https://github.com/upstream/original",
    });
    expect(details.forkSource).toEqual({
      fullName: "upstream/root",
      htmlUrl: "https://github.com/upstream/root",
    });
  });

  it("emits languages only when includeLanguageBreakdown is on", async () => {
    useRoutes(
      inventoryRoutes([
        {
          path: "/repos/testorg/repo/languages",
          body: { TypeScript: 91234, JavaScript: 1234 },
        },
      ]),
    );

    const off = await collectAssets(new GithubImporter(), { org: "testorg" });
    expect(detailsOf(repoAsset(off)).languages).toBeUndefined();

    const on = await collectAssets(new GithubImporter(), {
      org: "testorg",
      includeLanguageBreakdown: true,
    });
    const details = detailsOf(repoAsset(on));
    expect(details.languages).toEqual({ TypeScript: 91234, JavaScript: 1234 });
    expect(capsOf(repoAsset(on)).languages?.status).toBe("OK");
  }, 20000);

  it("marks languages degraded when /languages fails", async () => {
    useRoutes(
      inventoryRoutes([
        {
          path: "/repos/testorg/repo/languages",
          status: 403,
          body: { message: "Forbidden" },
        },
      ]),
    );

    const assets = await collectAssets(new GithubImporter(), {
      org: "testorg",
      includeLanguageBreakdown: true,
    });
    const repo = repoAsset(assets);

    expect(detailsOf(repo).languages).toBeUndefined();
    expect(capsOf(repo).languages?.status).toBe("FORBIDDEN");
  });

  it("normalizes environment governance into rawConfig.githubEnvironment", async () => {
    useRoutes(
      inventoryRoutes([
        {
          path: "/repos/testorg/repo/environments",
          body: {
            total_count: 1,
            environments: [
              {
                name: "production",
                protection_rules: [
                  { id: 1, type: "wait_timer", wait_timer: 30 },
                  {
                    id: 2,
                    type: "required_reviewers",
                    prevent_self_review: true,
                    reviewers: [{ type: "User" }, { type: "Team" }],
                  },
                ],
                deployment_branch_policy: {
                  protected_branches: true,
                  custom_branch_policies: false,
                },
                can_admins_bypass: true,
              },
            ],
          },
        },
        {
          path: "/repos/testorg/repo/deployments",
          query: { environment: "production" },
          body: [{ id: 900, ref: "main", created_at: "2026-02-01T00:00:00Z" }],
        },
        {
          path: "/repos/testorg/repo/deployments/900/statuses",
          body: [{ state: "success" }],
        },
      ]),
    );

    const assets = await collectAssets(new GithubImporter(), { org: "testorg" });
    const repo = repoAsset(assets);
    const env = (repo?.instances ?? []).find(
      (i) => i.externalId === "env:production",
    );

    expect(env?.environment).toBe("PRODUCTION");
    const ghEnv = env?.rawConfig?.githubEnvironment as Record<string, unknown>;
    expect(ghEnv).toBeDefined();
    expect(ghEnv.protectionRules).toEqual([
      { type: "wait_timer", waitTimerMinutes: 30 },
      {
        type: "required_reviewers",
        preventSelfReview: true,
        reviewerCount: 2,
      },
    ]);
    expect(ghEnv.deploymentBranchPolicy).toEqual({
      protectedBranches: true,
      customBranchPolicies: false,
    });
    expect(ghEnv.canAdminsBypass).toBe(true);
    expect(capsOf(repo).environments?.status).toBe("OK");
    expect(capsOf(repo).deployments?.status).toBe("OK");
  });

  it("paginates environments fully and emits an instance per page", async () => {
    useRoutes(
      inventoryRoutes([
        {
          path: "/repos/testorg/repo/environments",
          query: { page: "2" },
          body: {
            total_count: 3,
            environments: [{ name: "canary" }],
          },
        },
        {
          path: "/repos/testorg/repo/environments",
          headers: {
            link: nextPageLink(
              "https://api.github.com/repos/testorg/repo/environments?page=2&per_page=100",
            ),
          },
          body: {
            total_count: 3,
            environments: [{ name: "prod" }, { name: "staging" }],
          },
        },
        {
          path: "/repos/testorg/repo/deployments",
          body: [],
        },
      ]),
    );

    const assets = await collectAssets(new GithubImporter(), { org: "testorg" });
    const repo = repoAsset(assets);
    const envIds = (repo?.instances ?? [])
      .map((i) => i.externalId)
      .filter((id) => id.startsWith("env:"));

    expect(envIds.sort()).toEqual(["env:canary", "env:prod", "env:staging"]);
    expect(capsOf(repo).environments?.status).toBe("OK");
  });

  it("records environments/deployments markers and completes on 403", async () => {
    useRoutes(
      inventoryRoutes([
        {
          path: "/repos/testorg/repo/environments",
          status: 403,
          body: { message: "Forbidden" },
        },
      ]),
    );

    const assets = await collectAssets(new GithubImporter(), { org: "testorg" });
    const repo = repoAsset(assets);

    expect(repo).toBeDefined();
    expect(capsOf(repo).environments?.status).toBe("FORBIDDEN");
    expect(capsOf(orgAsset(assets)).environments?.status).toBe("FORBIDDEN");
    // Branch inventory + instances are independent of environments.
    expect(detailsOf(repo).branches).toHaveLength(4);
    expect(
      (repo?.instances ?? []).some((i) => i.externalId.startsWith("branch:")),
    ).toBe(true);
  });

  it("paginates org packages fully when includePackages is on", async () => {
    useRoutes([
      ...inventoryRoutes(),
      {
        path: "/orgs/testorg/packages",
        query: { package_type: "container", page: "2" },
        body: [
          {
            id: 602,
            name: "second-image",
            package_type: "container",
            visibility: "private",
          },
        ],
      },
      {
        path: "/orgs/testorg/packages",
        query: { package_type: "container" },
        headers: {
          link: nextPageLink(
            "https://api.github.com/orgs/testorg/packages?package_type=container&page=2&per_page=100",
          ),
        },
        body: [
          {
            id: 601,
            name: "first-image",
            package_type: "container",
            visibility: "public",
          },
        ],
      },
    ]);

    const assets = await collectAssets(new GithubImporter(), {
      org: "testorg",
      includePackages: true,
    });
    const packages = assets.filter((a) => a.resourceType === "github:package");

    expect(packages.map((p) => p.externalId).sort()).toEqual(["601", "602"]);
  });

  it("marks packages degraded when every package-type listing fails", async () => {
    useRoutes(
      inventoryRoutes([
        {
          path: "/orgs/testorg/packages",
          status: 403,
          body: { message: "Forbidden" },
        },
      ]),
    );

    const assets = await collectAssets(new GithubImporter(), {
      org: "testorg",
      includePackages: true,
    });

    expect(
      assets.filter((a) => a.resourceType === "github:package"),
    ).toHaveLength(0);
    // FR-013: per-type failures must surface — not a silent OK.
    expect(capsOf(orgAsset(assets)).packages?.status).toBe("FORBIDDEN");
  });

  it("aggregates per-repo capability markers worst-status-wins onto the org asset", async () => {
    useRoutes(
      inventoryRoutes([
        {
          path: "/orgs/testorg/repos",
          body: [
            makeRepo({ id: 201, full_name: "testorg/repo-a", name: "repo-a" }),
            makeRepo({ id: 202, full_name: "testorg/repo-b", name: "repo-b" }),
          ],
        },
        {
          path: "/repos/testorg/repo-b/branches",
          status: 403,
          body: { message: "Forbidden" },
        },
        {
          path: "/repos/testorg/repo-a/environments",
          body: { total_count: 0, environments: [] },
        },
        { path: "/repos/testorg/repo-a/branches", body: INVENTORY_BRANCHES },
        {
          path: "/repos/testorg/repo-a/branches/develop",
          body: makeBranchDetail("develop", SHA_DEVELOP, "2026-02-01T00:00:00Z"),
        },
        { path: "/repos/testorg/repo-a/releases", body: [] },
        { path: "/repos/testorg/repo-a/tags", body: [] },
        {
          path: "/repos/testorg/repo-b/environments",
          body: { total_count: 0, environments: [] },
        },
        { path: "/repos/testorg/repo-b/releases", body: [] },
        { path: "/repos/testorg/repo-b/tags", body: [] },
      ]),
    );

    const assets = await collectAssets(new GithubImporter(), { org: "testorg" });
    const repoA = assets.find(
      (a) => a.resourceType === "github:repository" && a.name === "testorg/repo-a",
    );
    const repoB = assets.find(
      (a) => a.resourceType === "github:repository" && a.name === "testorg/repo-b",
    );

    expect(capsOf(repoA).branches?.status).toBe("OK");
    expect(capsOf(repoB).branches?.status).toBe("FORBIDDEN");

    const orgCaps = capsOf(orgAsset(assets));
    expect(orgCaps.branches?.status).toBe("FORBIDDEN");
    expect(orgCaps.branches?.message).toContain("affected repositories: 1");
    expect(orgCaps.versionInventory?.status).toBe("OK");
    expect(orgCaps.environments?.status).toBe("OK");
  });
});
