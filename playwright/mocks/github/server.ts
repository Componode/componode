import { startDataServer, startControlServer, makeScenarioStore, RequestLog, json, env } from '../lib/mock.js';

// GitHub REST mock — the exact endpoints importer-github calls.
// Scenarios: baseline | empty | changed | omitted | capability-failure |
// org-fallback (403 on orgs.get) | server-error (5xx on orgs.get).

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

interface Repo { id: number; name: string; envs: string[]; }

function repos(scenario: string): Repo[] {
  switch (scenario) {
    case 'empty': return [];
    case 'omitted': return [{ id: 101, name: 'svc-alpha', envs: ['production'] }];
    case 'changed': return [
      { id: 101, name: 'svc-alpha', envs: ['production', 'staging'] },
      { id: 102, name: 'svc-beta', envs: ['production'] },
    ];
    default: return [
      { id: 101, name: 'svc-alpha', envs: ['production'] },
      { id: 102, name: 'svc-beta', envs: ['production'] },
    ];
  }
}

const repoJson = (r: Repo) => ({
  id: r.id, name: r.name, full_name: `${ORG}/${r.name}`,
  owner: { login: ORG }, html_url: `https://github.test/${ORG}/${r.name}`,
  fork: false, archived: false, language: 'TypeScript', topics: ['pw'],
  visibility: 'private', default_branch: 'main',
  updated_at: '2026-01-01T00:00:00Z', pushed_at: '2026-01-01T00:00:00Z',
});

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
      const r = repo ?? { id: 999, name: repoName, envs: [] };

      if (sub === '') return json(res, 200, repoJson(r));
      if (sub === '/environments') {
        return json(res, 200, {
          total_count: r.envs.length,
          environments: r.envs.map((e, i) => ({ id: 6000 + i, name: e, url: `https://github.test/env/${e}`, protection_rules: [] })),
        });
      }
      if (sub === '/deployments') {
        return json(res, 200, r.envs.map((e, i) => ({
          id: 7000 + i, sha: 'abc123', ref: 'main', task: 'deploy', environment: e,
          description: 'pw deploy', created_at: '2026-01-02T00:00:00Z', updated_at: '2026-01-02T00:00:00Z',
          statuses_url: `https://x/deployments/${7000 + i}/statuses`, node_id: 'n',
        })));
      }
      const depStatus = sub.match(/^\/deployments\/(\d+)\/statuses$/);
      if (depStatus) {
        return json(res, 200, [{ id: 7100, state: 'success', description: 'ok', environment: 'production', created_at: '2026-01-02T00:01:00Z', updated_at: '2026-01-02T00:01:00Z' }]);
      }
      if (sub === '/releases/latest') {
        if (s === 'capability-failure') return json(res, 403, { message: 'Forbidden' });
        return json(res, 200, {
          id: 7200, tag_name: 'v1.2.3', name: 'v1.2.3', draft: false, prerelease: false,
          created_at: '2026-01-03T00:00:00Z', published_at: '2026-01-03T00:00:00Z',
          html_url: 'https://github.test/release', assets: [],
        });
      }
      if (sub === '/branches') {
        const { page, link } = paginate(url, [{ name: 'main', commit: { sha: 'abc123', url: 'https://x/c/abc' }, protected: true }], 100, req.headers.host ?? 'mock-github');
        return json(res, 200, page, link ? { link } : {});
      }
      if (sub.startsWith('/branches/')) {
        return json(res, 200, {
          name: 'main', commit: { sha: 'abc123', commit: { message: 'pw commit', committer: { date: '2026-01-02T00:00:00Z' } } },
          protected: true,
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
