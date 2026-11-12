import { startDataServer, startControlServer, makeScenarioStore, RequestLog, json, env } from '../lib/mock.js';

// GitHub REST mock — the exact endpoints importer-github calls.
// Scenarios: baseline | empty | changed | omitted | capability-failure |
// org-fallback (403 on orgs.get) | server-error (5xx on orgs.get).
//
// Spec 072 (github-branch-inventory): repos carry multi-branch fixtures —
// environment-mapped names (develop/staging) that still emit spec-011 branch
// instances alongside unmapped names (main, feature/*, dependabot/*) that
// exist only in the branch inventory — plus paginated release/tag lists, a
// languages map, and environment governance payloads
// (protection_rules / deployment_branch_policy / can_admins_bypass).

const SCENARIOS = [
  'baseline', 'empty', 'changed', 'omitted',
  'capability-failure', 'org-fallback', 'server-error',
] as const;
type Scenario = (typeof SCENARIOS)[number];
const store = makeScenarioStore([...SCENARIOS], 'baseline');
const log = new RequestLog();

const ORG = 'pw-org';
const orgObj = {
  id: 70001, login: ORG, name: 'PW Org', html_url: 'https://github.test/pw-org',
  description: 'synthetic org', created_at: '2024-01-01T00:00:00Z', is_verified: true,
  plan: { name: 'team', seats: 10, filled_seats: 3, private_repos: 2 },
  two_factor_requirement_enabled: true, default_repository_permission: 'read',
  members_can_create_repositories: false, members_can_create_teams: false,
  public_repos: 1, total_private_repos: 2, owned_private_repos: 2,
  disk_usage: 1234, collaborators: 3,
};

// ---- spec-072 fixtures ----------------------------------------------------

interface BranchFixture {
  name: string;
  sha: string;
  protected: boolean;
  /** Served as commit.committer.date by GET /branches/{branch}. */
  lastCommitAt: string;
}

interface EnvFixture {
  name: string;
  protectionRules?: Record<string, unknown>[];
  deploymentBranchPolicy?: { protected_branches: boolean; custom_branch_policies: boolean } | null;
  canAdminsBypass?: boolean;
}

interface ReleaseAssetFixture {
  name: string;
  size: number;
  download_count: number;
}

interface ReleaseFixture {
  id: number;
  tag_name: string;
  name: string | null;
  draft: boolean;
  prerelease: boolean;
  target_commitish: string;
  created_at: string;
  published_at: string | null;
  html_url: string;
  assets: ReleaseAssetFixture[];
}

interface TagFixture {
  name: string;
  sha: string;
}

interface Repo {
  id: number;
  name: string;
  defaultBranch: string;
  fork: boolean;
  archived: boolean;
  envs: EnvFixture[];
  branches: BranchFixture[];
  releases: ReleaseFixture[];
  tags: TagFixture[];
  languages: Record<string, number>;
}

// svc-alpha: 4 branches — `main` (default+protected, unmapped), `develop`
// (mapped → DEV branch instance), `feature/checkout-flow` and a dependabot
// branch (both unmapped → inventory only). Inventory therefore differs from
// the instance set, which is the point of the feature.
const ALPHA_BRANCHES: BranchFixture[] = [
  { name: 'main', sha: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4', protected: true, lastCommitAt: '2026-01-05T10:00:00Z' },
  { name: 'develop', sha: 'b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5', protected: false, lastCommitAt: '2026-01-04T10:00:00Z' },
  { name: 'feature/checkout-flow', sha: 'c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6', protected: false, lastCommitAt: '2026-01-03T10:00:00Z' },
  { name: 'dependabot/npm_and_yarn/lodash-4.17.21', sha: 'd4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f607', protected: true, lastCommitAt: '2026-01-02T10:00:00Z' },
];

// svc-beta: default branch is `trunk` (not `main`) so isDefault follows the
// repo's reported default_branch rather than a hardcoded name.
const BETA_BRANCHES: BranchFixture[] = [
  { name: 'trunk', sha: 'e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718', protected: true, lastCommitAt: '2026-01-05T11:00:00Z' },
  { name: 'staging', sha: 'f60718293a4b5c6d7e8f90a1b2c3d4e5f6071829', protected: false, lastCommitAt: '2026-01-04T11:00:00Z' },
];

const PRODUCTION_GOVERNED: EnvFixture = {
  name: 'production',
  protectionRules: [
    { id: 6101, node_id: 'PR_kwDO_alpha_wait_timer', type: 'wait_timer', wait_timer: 30 },
    {
      id: 6102, node_id: 'PR_kwDO_alpha_reviewers', type: 'required_reviewers',
      prevent_self_review: true,
      reviewers: [
        { type: 'User', reviewer: { login: 'pw-reviewer-a' } },
        { type: 'Team', reviewer: { slug: 'platform' } },
      ],
    },
  ],
  deploymentBranchPolicy: { protected_branches: true, custom_branch_policies: false },
  canAdminsBypass: true,
};

// 'changed' scenario second env — partial governance (no branch policy).
const STAGING_PARTIAL: EnvFixture = {
  name: 'staging',
  protectionRules: [{ id: 6201, node_id: 'PR_kwDO_alpha_staging_wait', type: 'wait_timer', wait_timer: 5 }],
  canAdminsBypass: false,
};

const BETA_PRODUCTION: EnvFixture = {
  name: 'production',
  protectionRules: [],
  deploymentBranchPolicy: { protected_branches: false, custom_branch_policies: true },
  canAdminsBypass: false,
};

const ALPHA_RELEASES: ReleaseFixture[] = [
  {
    id: 7302, tag_name: 'v2.0.0-draft', name: 'v2.0.0 (draft)', draft: true, prerelease: false,
    target_commitish: 'main', created_at: '2026-01-05T00:00:00Z', published_at: null,
    html_url: 'https://github.test/pw-org/svc-alpha/releases/tag/v2.0.0-draft', assets: [],
  },
  {
    id: 7301, tag_name: 'v1.1.0-rc.1', name: 'v1.1.0 release candidate', draft: false, prerelease: true,
    target_commitish: 'develop', created_at: '2026-01-04T00:00:00Z', published_at: '2026-01-04T00:00:00Z',
    html_url: 'https://github.test/pw-org/svc-alpha/releases/tag/v1.1.0-rc.1',
    assets: [{ name: 'svc-alpha-1.1.0-rc.1.zip', size: 2048, download_count: 3 }],
  },
  {
    id: 7300, tag_name: 'v1.0.0', name: 'v1.0.0', draft: false, prerelease: false,
    target_commitish: 'main', created_at: '2026-01-03T00:00:00Z', published_at: '2026-01-03T00:00:00Z',
    html_url: 'https://github.test/pw-org/svc-alpha/releases/tag/v1.0.0',
    assets: [
      { name: 'svc-alpha-1.0.0.zip', size: 1024, download_count: 12 },
      { name: 'checksums.txt', size: 256, download_count: 9 },
    ],
  },
];

// Tags ≠ releases: `nightly`/`legacy-2025` have no release record; `v1.0.0`
// backs the v1.0.0 release (GitHub lists release tags here too).
const ALPHA_TAGS: TagFixture[] = [
  { name: 'nightly', sha: '0718293a4b5c6d7e8f90a1b2c3d4e5f60718293a' },
  { name: 'v1.0.0', sha: '18293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b' },
  { name: 'legacy-2025', sha: '293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c' },
];

const BETA_RELEASES: ReleaseFixture[] = [
  {
    id: 7400, tag_name: 'v0.9.0', name: 'v0.9.0', draft: false, prerelease: false,
    target_commitish: 'trunk', created_at: '2026-01-02T00:00:00Z', published_at: '2026-01-02T00:00:00Z',
    html_url: 'https://github.test/pw-org/svc-beta/releases/tag/v0.9.0', assets: [],
  },
];

const BETA_TAGS: TagFixture[] = [
  { name: 'beta-2026-01', sha: '3a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d' },
];

function repos(scenario: string): Repo[] {
  const alpha = (envs: EnvFixture[]): Repo => ({
    id: 101, name: 'svc-alpha', defaultBranch: 'main', fork: false, archived: false,
    envs, branches: ALPHA_BRANCHES, releases: ALPHA_RELEASES, tags: ALPHA_TAGS,
    languages: { TypeScript: 91234, JavaScript: 1234, Shell: 56 },
  });
  const beta = (envs: EnvFixture[]): Repo => ({
    id: 102, name: 'svc-beta', defaultBranch: 'trunk', fork: false, archived: false,
    envs, branches: BETA_BRANCHES, releases: BETA_RELEASES, tags: BETA_TAGS,
    languages: { Python: 4321, Shell: 210 },
  });
  switch (scenario) {
    case 'empty': return [];
    case 'omitted': return [alpha([PRODUCTION_GOVERNED])];
    case 'changed': return [alpha([PRODUCTION_GOVERNED, STAGING_PARTIAL]), beta([BETA_PRODUCTION])];
    default: return [alpha([PRODUCTION_GOVERNED]), beta([BETA_PRODUCTION])];
  }
}

const EMPTY_REPO_DEFAULTS = {
  defaultBranch: 'main', fork: false, archived: false,
  envs: [] as EnvFixture[], branches: [] as BranchFixture[],
  releases: [] as ReleaseFixture[], tags: [] as TagFixture[],
  languages: {} as Record<string, number>,
};

const repoJson = (r: Repo) => ({
  id: r.id, name: r.name, full_name: `${ORG}/${r.name}`,
  owner: { login: ORG }, html_url: `https://github.test/${ORG}/${r.name}`,
  fork: r.fork, archived: r.archived, disabled: false,
  language: 'TypeScript', topics: ['pw'],
  visibility: 'private', default_branch: r.defaultBranch,
  size: 2048,
  license: { key: 'apache-2.0', name: 'Apache License 2.0', spdx_id: 'Apache-2.0', html_url: 'https://github.test/license/apache-2.0' },
  open_issues_count: 7,
  created_at: '2025-06-01T00:00:00Z',
  updated_at: '2026-01-06T00:00:00Z', pushed_at: '2026-01-06T00:00:00Z',
  parent: null, source: null,
});

// Single GitHub environment payload — shared by the list and per-env routes.
// Governance fields (protection_rules / deployment_branch_policy /
// can_admins_bypass) mirror the real API response the importer normalizes
// into rawConfig.githubEnvironment (spec 072 contract §3).
function environmentJson(r: Repo, e: EnvFixture, i: number) {
  return {
    id: 6000 + i,
    node_id: `EN_kwDO_${r.name}_${e.name}`,
    name: e.name,
    url: `https://github.test/repos/${ORG}/${r.name}/environments/${e.name}`,
    html_url: `https://github.test/${ORG}/${r.name}/deployments/activity_log?environments_filter=${e.name}`,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    protection_rules: e.protectionRules ?? [],
    ...(e.deploymentBranchPolicy !== undefined
      ? { deployment_branch_policy: e.deploymentBranchPolicy }
      : {}),
    ...(e.canAdminsBypass !== undefined
      ? { can_admins_bypass: e.canAdminsBypass }
      : {}),
  };
}

const teams = [
  { id: 501, slug: 'platform', name: 'Platform', members_count: 4, repos_count: 2, privacy: 'closed', parent: null },
  { id: 502, slug: 'app-team', name: 'App Team', members_count: 6, repos_count: 1, privacy: 'closed', parent: { slug: 'platform' } },
];

function paginate(url: URL, items: unknown[], perPage: number, host: string): { page: unknown[]; link?: string } {
  const page = Number(url.searchParams.get('page') ?? '1');
  const start = (page - 1) * perPage;
  const slice = items.slice(start, start + perPage);
  let link: string | undefined;
  if (start + perPage < items.length) {
    const next = new URL(`https://${host}${url.pathname}${url.search}`);
    next.searchParams.set('page', String(page + 1));
    link = `<${next.toString()}>; rel="next"`;
  }
  return { page: slice, link };
}

const server = startDataServer({
  port: Number(env('MOCK_PORT', '9443')),
  tls: { certPath: env('MOCK_TLS_CERT'), keyPath: env('MOCK_TLS_KEY') },
  handler: (req, body, res) => {
    const url = new URL(req.url ?? '/', 'https://x');
    const path = url.pathname;
    log.add({ method: req.method ?? 'GET', path, scenario: store.current });
    const s: Scenario = store.current;

    if (path === '/rate_limit') {
      return json(res, 200, {
        resources: { core: { limit: 5000, remaining: 4999, used: 1, reset: 2000000000 } },
        rate: { limit: 5000, remaining: 4999, used: 1, reset: 2000000000 },
      });
    }

    const orgMatch = path.match(/^\/orgs\/([^/]+)$/);
    if (orgMatch) {
      if (s === 'server-error') return json(res, 500, { message: 'mock 5xx' });
      if (s === 'org-fallback') return json(res, 403, { message: 'Forbidden' });
      return json(res, 200, orgObj);
    }

    if (path === `/orgs/${ORG}/teams`) {
      if (s === 'capability-failure') return json(res, 403, { message: 'Forbidden' });
      const { page, link } = paginate(url, s === 'empty' ? [] : teams, 2, req.headers.host ?? 'mock-github');
      return json(res, 200, page, link ? { link } : {});
    }

    if (path === `/orgs/${ORG}/repos`) {
      const { page, link } = paginate(url, repos(s).map(repoJson), 1, req.headers.host ?? 'mock-github');
      return json(res, 200, page, link ? { link } : {});
    }

    if (path === `/orgs/${ORG}/actions/runners`) {
      if (s === 'capability-failure') return json(res, 403, { message: 'Forbidden' });
      return json(res, 200, {
        total_count: 2,
        runners: [
          { id: 9001, name: 'runner-1', os: 'linux', status: 'online', busy: false, labels: [{ name: 'self-hosted' }] },
          { id: 9002, name: 'runner-2', os: 'linux', status: 'offline', busy: false, labels: [] },
        ],
      });
    }

    if (path === `/orgs/${ORG}/packages`) {
      if (s === 'capability-failure') return json(res, 403, { message: 'Forbidden' });
      return json(res, 200, [
        { id: 8001, name: 'pw-package', package_type: 'container', owner: { login: ORG }, version_count: 3, visibility: 'private', url: 'https://github.test/pkg' },
      ]);
    }

    // Billing family — capability-gated; 403 → degraded marker, never run failure.
    if (path.startsWith(`/orgs/${ORG}/settings/billing/`) || path.startsWith(`/organizations/${ORG}/settings/billing/`)) {
      if (s === 'capability-failure') return json(res, 403, { message: 'Forbidden' });
      if (path.endsWith('/usage') || path.includes('/billing/usage')) {
        return json(res, 200, { usageItems: [{ sku: 'actions-linux', quantity: 120, grossAmount: 1.5, discountAmount: 0, netAmount: 1.5, organizationName: ORG }] });
      }
      if (path.endsWith('/actions')) {
        return json(res, 200, { total_minutes_used: 120, total_paid_minutes_used: 0, included_minutes: 3000, minutes_used_breakdown: { UBUNTU: 120 } });
      }
      if (path.endsWith('/packages')) {
        return json(res, 200, { total_gigabytes_bandwidth_used: 1, total_paid_gigabytes_bandwidth_used: 0, included_gigabytes_bandwidth: 1 });
      }
      if (path.endsWith('/shared-storage')) {
        return json(res, 200, { days_left_in_billing_cycle: 10, estimated_paid_storage_for_month: 0.5, estimated_storage_for_month: 0.5 });
      }
      return json(res, 200, { usageItems: [] });
    }

    const repoMatch = path.match(/^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/);
    if (repoMatch) {
      const [, owner, repoName, sub = ''] = repoMatch;
      const repo = repos(s).find((r) => r.name === repoName);
      if (!repo && sub === '') return json(res, 404, { message: 'Not Found' });
      const r: Repo = repo ?? { id: 999, name: repoName, ...EMPTY_REPO_DEFAULTS };

      if (sub === '') return json(res, 200, repoJson(r));
      if (sub === '/environments') {
        if (s === 'capability-failure') return json(res, 403, { message: 'Forbidden' });
        return json(res, 200, {
          total_count: r.envs.length,
          environments: r.envs.map((e, i) => environmentJson(r, e, i)),
        });
      }
      const envMatch = sub.match(/^\/environments\/([^/]+)$/);
      if (envMatch) {
        if (s === 'capability-failure') return json(res, 403, { message: 'Forbidden' });
        const name = decodeURIComponent(envMatch[1]!);
        const idx = r.envs.findIndex((e) => e.name === name);
        if (idx < 0) return json(res, 404, { message: 'Environment not found' });
        return json(res, 200, environmentJson(r, r.envs[idx]!, idx));
      }
      if (sub === '/deployments') {
        if (s === 'capability-failure') return json(res, 403, { message: 'Forbidden' });
        // Honor ?environment= like the real API — each env gets its own
        // deployment so per-env instances carry the right facts.
        const envFilter = url.searchParams.get('environment');
        const defaultSha = r.branches.find((b) => b.name === r.defaultBranch)?.sha ?? 'abc123';
        return json(res, 200, r.envs
          .map((e, i) => ({
            id: 7000 + i, sha: defaultSha, ref: r.defaultBranch, task: 'deploy', environment: e.name,
            description: 'pw deploy', created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
            statuses_url: `https://x/deployments/${7000 + i}/statuses`, node_id: 'n',
          }))
          .filter((d) => !envFilter || d.environment === envFilter));
      }
      const depStatus = sub.match(/^\/deployments\/(\d+)\/statuses$/);
      if (depStatus) {
        return json(res, 200, [{ id: 7100, state: 'success', description: 'ok', environment: 'production', created_at: '2026-01-02T00:01:00Z', updated_at: '2026-01-02T00:01:00Z' }]);
      }
      if (sub === '/releases/latest') {
        if (s === 'capability-failure') return json(res, 403, { message: 'Forbidden' });
        // GitHub semantics: latest = newest non-draft, non-prerelease —
        // consistent with the /releases inventory fixtures below.
        const latest = r.releases.find((rel) => !rel.draft && !rel.prerelease);
        if (!latest) return json(res, 404, { message: 'No releases found' });
        return json(res, 200, {
          id: latest.id, tag_name: latest.tag_name, name: latest.name,
          draft: latest.draft, prerelease: latest.prerelease,
          target_commitish: latest.target_commitish,
          created_at: latest.created_at, published_at: latest.published_at,
          html_url: latest.html_url, assets: latest.assets,
        });
      }
      // Version inventory (spec 072): full paginated release + tag lists.
      if (sub === '/releases') {
        if (s === 'capability-failure') return json(res, 403, { message: 'Forbidden' });
        const { page, link } = paginate(url, r.releases, 2, req.headers.host ?? 'mock-github');
        return json(res, 200, page, link ? { link } : {});
      }
      if (sub === '/tags') {
        if (s === 'capability-failure') return json(res, 403, { message: 'Forbidden' });
        const { page, link } = paginate(url, r.tags.map((t) => ({
          name: t.name,
          commit: { sha: t.sha, url: `https://api.github.test/repos/${ORG}/${r.name}/commits/${t.sha}` },
          node_id: `TAG_${t.name}`,
        })), 2, req.headers.host ?? 'mock-github');
        return json(res, 200, page, link ? { link } : {});
      }
      if (sub === '/languages') {
        if (s === 'capability-failure') return json(res, 403, { message: 'Forbidden' });
        return json(res, 200, r.languages);
      }
      // Branch inventory shares this list call with spec-011 instance
      // classification — per_page fixture of 2 forces Link-header pagination.
      if (sub === '/branches') {
        if (s === 'capability-failure') return json(res, 403, { message: 'Forbidden' });
        const { page, link } = paginate(url, r.branches.map((b) => ({
          name: b.name,
          commit: { sha: b.sha, url: `https://api.github.test/repos/${ORG}/${r.name}/commits/${b.sha}` },
          protected: b.protected,
        })), 2, req.headers.host ?? 'mock-github');
        return json(res, 200, page, link ? { link } : {});
      }
      if (sub.startsWith('/branches/')) {
        if (s === 'capability-failure') return json(res, 403, { message: 'Forbidden' });
        const rawName = sub.slice('/branches/'.length);
        let branchName = rawName;
        try { branchName = decodeURIComponent(rawName); } catch { /* keep raw */ }
        const b = r.branches.find((x) => x.name === branchName);
        if (!b) return json(res, 404, { message: 'Branch not found' });
        return json(res, 200, {
          name: b.name,
          commit: {
            sha: b.sha,
            url: `https://api.github.test/repos/${ORG}/${r.name}/commits/${b.sha}`,
            commit: { message: `pw commit on ${b.name}`, committer: { date: b.lastCommitAt } },
          },
          protected: b.protected,
        });
      }
      if (sub === '/actions/workflows') {
        if (s === 'capability-failure') return json(res, 403, { message: 'Forbidden' });
        return json(res, 200, {
          total_count: 1,
          workflows: [{ id: 7300, name: 'ci', path: '.github/workflows/ci.yml', state: 'active', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', url: 'https://x/wf' }],
        });
      }
      return json(res, 404, { message: 'Not Found' });
    }

    return json(res, 404, { message: `mock-github: no route ${path}` });
  },
});

const control = startControlServer(Number(env('MOCK_CONTROL_PORT', '9444')), {
  getScenario: () => store.current,
  setScenario: (name) => {
    if (!(SCENARIOS as readonly string[]).includes(name)) return false;
    store.current = name as Scenario;
    return true;
  },
  scenarios: () => [...SCENARIOS],
  log,
});

console.log(`github mock https :${env('MOCK_PORT', '9443')} control :${env('MOCK_CONTROL_PORT', '9444')}`);
void server; void control;
