import { test, expect } from '@playwright/test';

const CTL = 'http://mock-control:9090';
const GH = 'https://mock-github:9443';
const auth = { authorization: 'Bearer x' };

async function scenario(name: string) {
  await fetch(`${CTL}/scenario/mock-github`, { method: 'POST', body: JSON.stringify({ name }) });
}

test.describe('github mock contracts', () => {
  test('orgs.get drives identity fallback semantics', async () => {
    await scenario('baseline');
    const ok = await fetch(`${GH}/orgs/pw-org`, { headers: auth });
    expect(ok.status).toBe(200);
    expect((await ok.json()).login).toBe('pw-org');

    await scenario('org-fallback');
    expect((await fetch(`${GH}/orgs/pw-org`, { headers: auth })).status).toBe(403);

    await scenario('server-error');
    expect((await fetch(`${GH}/orgs/pw-org`, { headers: auth })).status).toBe(500);
  });

  test('repos paginate via Link headers', async () => {
    await scenario('baseline');
    const p1 = await fetch(`${GH}/orgs/pw-org/repos?type=all&per_page=1`, { headers: auth });
    expect(p1.status).toBe(200);
    const link = p1.headers.get('link') ?? '';
    expect(link).toContain('rel="next"');
    const page1 = await p1.json();
    const p2 = await fetch(new URL(link.match(/<([^>]+)>/)![1]!).toString(), { headers: auth });
    const page2 = await p2.json();
    expect(page1.length + page2.length).toBeGreaterThanOrEqual(2);
  });

  test('capability endpoints degrade on 403 without global failure', async () => {
    await scenario('capability-failure');
    for (const p of ['/orgs/pw-org/teams', '/orgs/pw-org/actions/runners', '/orgs/pw-org/settings/billing/actions']) {
      expect((await fetch(`${GH}${p}`, { headers: auth })).status, p).toBe(403);
    }
    // Core endpoints still work.
    expect((await fetch(`${GH}/orgs/pw-org`, { headers: auth })).status).toBe(200);
  });

  test('repo inventory endpoints serve spec-072 fixtures', async () => {
    await scenario('baseline');

    // Multi-branch fixture: mapped (develop) + unmapped (main, feature/*,
    // dependabot/*) names — inventory must differ from instance mapping.
    const b1 = await fetch(`${GH}/repos/pw-org/svc-alpha/branches?per_page=100`, { headers: auth });
    expect(b1.status).toBe(200);
    const bPage1 = await b1.json();
    expect(bPage1).toHaveLength(2);
    const bLink = b1.headers.get('link') ?? '';
    expect(bLink).toContain('rel="next"');
    const bPage2 = await (await fetch(new URL(bLink.match(/<([^>]+)>/)![1]!).toString(), { headers: auth })).json();
    const allBranches = [...bPage1, ...bPage2];
    expect(allBranches.map((b: any) => b.name).sort()).toEqual([
      'dependabot/npm_and_yarn/lodash-4.17.21',
      'develop',
      'feature/checkout-flow',
      'main',
    ]);
    const main = allBranches.find((b: any) => b.name === 'main');
    expect(main.protected).toBe(true);
    expect(main.commit.sha).toBeTruthy();

    // Per-branch detail (last-activity lookups) resolves fixture branches,
    // including names containing slashes.
    const bd = await fetch(`${GH}/repos/pw-org/svc-alpha/branches/develop`, { headers: auth });
    expect(bd.status).toBe(200);
    const bdBody = await bd.json();
    expect(bdBody.name).toBe('develop');
    expect(bdBody.commit.commit.committer.date).toBe('2026-01-04T10:00:00Z');
    expect((await fetch(`${GH}/repos/pw-org/svc-alpha/branches/nope`, { headers: auth })).status).toBe(404);

    // Releases paginate: draft + prerelease + normal, assets summarized.
    const r1 = await fetch(`${GH}/repos/pw-org/svc-alpha/releases?per_page=100`, { headers: auth });
    expect(r1.status).toBe(200);
    const rPage1 = await r1.json();
    expect(rPage1).toHaveLength(2);
    const rLink = r1.headers.get('link') ?? '';
    expect(rLink).toContain('rel="next"');
    const rPage2 = await (await fetch(new URL(rLink.match(/<([^>]+)>/)![1]!).toString(), { headers: auth })).json();
    const releases = [...rPage1, ...rPage2];
    const byTag = new Map<string, any>(releases.map((r: any) => [r.tag_name, r] as [string, any]));
    expect(byTag.get('v1.0.0').draft).toBe(false);
    expect(byTag.get('v1.0.0').prerelease).toBe(false);
    expect(byTag.get('v1.0.0').assets).toHaveLength(2);
    expect(byTag.get('v1.1.0-rc.1').prerelease).toBe(true);
    expect(byTag.get('v2.0.0-draft').draft).toBe(true);
    expect(byTag.get('v2.0.0-draft').published_at).toBeNull();

    // Tags paginate independently of releases.
    const t1 = await fetch(`${GH}/repos/pw-org/svc-alpha/tags?per_page=100`, { headers: auth });
    const tPage1 = await t1.json();
    expect(tPage1).toHaveLength(2);
    const tLink = t1.headers.get('link') ?? '';
    const tPage2 = await (await fetch(new URL(tLink.match(/<([^>]+)>/)![1]!).toString(), { headers: auth })).json();
    expect([...tPage1, ...tPage2].map((t: any) => t.name).sort()).toEqual(['legacy-2025', 'nightly', 'v1.0.0']);

    // Languages is a plain byte map, not a paginated list.
    const lang = await fetch(`${GH}/repos/pw-org/svc-alpha/languages`, { headers: auth });
    expect(lang.status).toBe(200);
    const langBody = await lang.json();
    expect(langBody.TypeScript).toBe(91234);
    expect(langBody.Python).toBeUndefined();

    // Environments carry governance payloads for spec-072 rawConfig.
    const envs = await fetch(`${GH}/repos/pw-org/svc-alpha/environments`, { headers: auth });
    const envBody = await envs.json();
    const prod = envBody.environments.find((e: any) => e.name === 'production');
    expect(prod.protection_rules.map((r: any) => r.type)).toEqual(['wait_timer', 'required_reviewers']);
    expect(prod.protection_rules[0].wait_timer).toBe(30);
    expect(prod.protection_rules[1].prevent_self_review).toBe(true);
    expect(prod.protection_rules[1].reviewers).toHaveLength(2);
    expect(prod.deployment_branch_policy).toEqual({ protected_branches: true, custom_branch_policies: false });
    expect(prod.can_admins_bypass).toBe(true);

    // The per-environment route serves the same governance payload.
    const prodSingle = await fetch(`${GH}/repos/pw-org/svc-alpha/environments/production`, { headers: auth });
    expect(prodSingle.status).toBe(200);
    expect((await prodSingle.json()).can_admins_bypass).toBe(true);

    // Deployments honor ?environment= so each env instance sees its own
    // latest deployment (baseline alpha has only `production`).
    const depsAll = await (await fetch(`${GH}/repos/pw-org/svc-alpha/deployments`, { headers: auth })).json();
    expect(depsAll.map((d: any) => d.environment)).toEqual(['production']);
    const depsProd = await (await fetch(`${GH}/repos/pw-org/svc-alpha/deployments?environment=production`, { headers: auth })).json();
    expect(depsProd).toHaveLength(1);
    const depsNone = await (await fetch(`${GH}/repos/pw-org/svc-alpha/deployments?environment=staging`, { headers: auth })).json();
    expect(depsNone).toHaveLength(0);

    // Repo payload carries every metadata field the importer surfaces.
    const repo = await fetch(`${GH}/repos/pw-org/svc-alpha`, { headers: auth });
    const repoBody = await repo.json();
    expect(repoBody.default_branch).toBe('main');
    expect(repoBody.disabled).toBe(false);
    expect(repoBody.fork).toBe(false);
    expect(repoBody.archived).toBe(false);
    expect(repoBody.size).toBe(2048);
    expect(repoBody.license.spdx_id).toBe('Apache-2.0');
    expect(repoBody.open_issues_count).toBe(7);
    expect(repoBody.created_at).toBe('2025-06-01T00:00:00Z');
    expect(repoBody.pushed_at).toBe('2026-01-06T00:00:00Z');
    expect(repoBody.updated_at).toBe('2026-01-06T00:00:00Z');
    expect(repoBody.language).toBe('TypeScript');
    expect(repoBody.topics).toEqual(['pw']);
    expect(repoBody.visibility).toBe('private');
    expect(repoBody.parent).toBeNull();
    expect(repoBody.source).toBeNull();

    // svc-beta's default branch is `trunk` — isDefault must not assume `main`.
    const betaBranches = await (await fetch(`${GH}/repos/pw-org/svc-beta/branches?per_page=100`, { headers: auth })).json();
    expect(betaBranches.map((b: any) => b.name).sort()).toEqual(['staging', 'trunk']);
    const betaRepo = await (await fetch(`${GH}/repos/pw-org/svc-beta`, { headers: auth })).json();
    expect(betaRepo.default_branch).toBe('trunk');
  });

  test('capability-failure covers repo inventory endpoints', async () => {
    await scenario('capability-failure');
    for (const p of [
      '/repos/pw-org/svc-alpha/branches',
      '/repos/pw-org/svc-alpha/branches/main',
      '/repos/pw-org/svc-alpha/environments',
      '/repos/pw-org/svc-alpha/deployments',
      '/repos/pw-org/svc-alpha/releases',
      '/repos/pw-org/svc-alpha/releases/latest',
      '/repos/pw-org/svc-alpha/tags',
      '/repos/pw-org/svc-alpha/languages',
    ]) {
      expect((await fetch(`${GH}${p}`, { headers: auth })).status, p).toBe(403);
    }
    // Repo listing still works — degradation is per-capability, not global.
    expect((await fetch(`${GH}/repos/pw-org/svc-alpha`, { headers: auth })).status).toBe(200);
    await scenario('baseline');
  });

  test('omitted and empty scenarios alter the inventory deterministically', async () => {
    await scenario('omitted');
    const o = await (await fetch(`${GH}/orgs/pw-org/repos?per_page=100`, { headers: auth })).json();
    expect(o).toHaveLength(1);
    await scenario('empty');
    const e = await (await fetch(`${GH}/orgs/pw-org/repos?per_page=100`, { headers: auth })).json();
    expect(e).toHaveLength(0);
  });
});
