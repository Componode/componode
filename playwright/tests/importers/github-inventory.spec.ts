import { test, expect } from '@playwright/test';
import { apiLogin, loginPage } from '../fixtures/auth.js';

// Spec 072 (github-branch-inventory) — Playwright coverage for the GitHub
// importer's inventory layer: complete branch inventory, release/tag version
// inventory, repo metadata, and environment governance on env instances,
// all carried in component details/rawConfig (contracts/github-inventory.md).

const BASE = 'https://app.componode-pw.test';
const CTL = 'http://mock-control:9090';

// Fixture SHAs mirrored from playwright/mocks/github/server.ts — asserted
// verbatim so mock drift fails loudly.
const SHA_MAIN = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4';
const SHA_FEATURE = 'c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f6';
const SHA_DEPENDABOT = 'd4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f607';
const SHA_NIGHTLY = '0718293a4b5c6d7e8f90a1b2c3d4e5f60718293a';
const SHA_TRUNK = 'e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718';

async function scenario(name: string) {
  await fetch(`${CTL}/scenario/mock-github`, { method: 'POST', body: JSON.stringify({ name }) });
}

async function triggerAndWait(api: any, configId: string): Promise<void> {
  const trig = await api('POST', `/api/v1/importer-configs/${configId}/trigger`, {});
  if (trig.status >= 400) throw new Error(`trigger failed ${trig.status}: ${JSON.stringify(trig.body)}`);
  const runId = trig.body.runId ?? trig.body.id;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const run = await api('GET', `/api/v1/importer-configs/${configId}/runs/${runId}`);
    const status = run.body.status ?? run.body.run?.status;
    if (status && !['PENDING', 'RUNNING'].includes(status)) {
      expect(status, `run ${runId}`).toBe('COMPLETED');
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('run timeout');
}

async function githubConfigId(api: any): Promise<string> {
  const configs = await api('GET', '/api/v1/importer-configs');
  const list = configs.body.items ?? configs.body.configs ?? configs.body.data ?? configs.body;
  const cfg = list.find((c: any) => (c.importerName ?? c.importer) === 'github');
  if (!cfg) throw new Error('no github importer config seeded');
  return cfg.id;
}

async function githubComponents(api: any): Promise<any[]> {
  // includeGone: a degraded run reports zero instances, so source-scoped
  // reconciliation retires the previous run's instances to GONE — and the
  // default list hides components whose instances are all GONE. The
  // capability-failure journey needs the component row regardless.
  const res = await api('GET', '/api/v1/components?provider=GITHUB&pageSize=100&includeGone=true');
  expect(res.status).toBe(200);
  return res.body.data ?? res.body.items ?? res.body.components ?? res.body;
}

async function componentDetail(api: any, id: string): Promise<any> {
  const res = await api('GET', `/api/v1/components/${id}`);
  expect(res.status).toBe(200);
  return res.body.component;
}

async function findRepo(api: any, fullName: string): Promise<any> {
  const list = await githubComponents(api);
  const item = list.find((c: any) => c.resourceType === 'github:repository' && c.name === fullName);
  if (!item) return null;
  return componentDetail(api, item.id);
}

async function runGithubImport(api: any) {
  await triggerAndWait(api, await githubConfigId(api));
}

test.describe('github importer branch/release inventory (spec 072)', () => {
  // The capability-failure test must never leak its scenario into sibling
  // specs — restore baseline after every test, pass or fail.
  test.afterEach(async () => {
    try { await scenario('baseline'); } catch { /* best-effort restore */ }
  });

  test('baseline run emits complete branch, release, tag inventory and repo metadata', async ({ request }) => {
    await scenario('baseline');
    const api = await apiLogin(request, BASE, 'EDITOR');
    await runGithubImport(api);

    const alpha = await findRepo(api, 'pw-org/svc-alpha');
    expect(alpha, 'svc-alpha repository component').toBeTruthy();
    const d = alpha.details ?? {};

    // Repo metadata scalars (repo object fields, zero extra calls).
    expect(d.defaultBranch).toBe('main');
    expect(d.archived).toBe(false);
    expect(d.disabled).toBe(false);
    expect(d.fork).toBe(false);
    expect(d.forkParent).toBeNull();
    expect(d.forkSource).toBeNull();
    expect(d.sizeKb).toBe(2048);
    expect(d.license?.spdxId).toBe('Apache-2.0');
    expect(d.openIssuesCount).toBe(7);
    expect(d.createdAt).toBe('2025-06-01T00:00:00Z');
    expect(d.pushedAt).toBe('2026-01-06T00:00:00Z');
    expect(d.updatedAt).toBe('2026-01-06T00:00:00Z');
    // Opt-in toggles stay off by default → keys absent entirely.
    expect(d.languages).toBeUndefined();

    // Branch inventory: EVERY fixture branch — including names outside the
    // environment mapping — with sha/protected/isDefault/url. lastActivityAt
    // is opt-in (includeBranchActivity=false) so it must be absent.
    const branches = d.branches ?? [];
    expect(branches.length, 'all fixture branches inventoried').toBe(4);
    const byName = new Map<string, any>(branches.map((b: any) => [b.name, b] as [string, any]));
    expect([...byName.keys()].sort()).toEqual([
      'dependabot/npm_and_yarn/lodash-4.17.21',
      'develop',
      'feature/checkout-flow',
      'main',
    ]);
    const main = byName.get('main');
    expect(main.sha).toBe(SHA_MAIN);
    expect(main.protected).toBe(true);
    expect(main.isDefault).toBe(true);
    expect(main.url).toContain('/tree/main');
    expect(main.lastActivityAt).toBeUndefined();
    const develop = byName.get('develop');
    expect(develop.isDefault).toBe(false);
    expect(develop.protected).toBe(false);
    expect(develop.sha).toBeTruthy();
    const feature = byName.get('feature/checkout-flow');
    expect(feature.sha).toBe(SHA_FEATURE);
    expect(feature.isDefault).toBe(false);
    const dependabot = byName.get('dependabot/npm_and_yarn/lodash-4.17.21');
    expect(dependabot.sha).toBe(SHA_DEPENDABOT);
    expect(dependabot.protected).toBe(true);

    // Release inventory: draft + prerelease + normal, fully paginated.
    const releases = d.releases ?? [];
    expect(releases.length, 'all fixture releases inventoried').toBe(3);
    const relByTag = new Map<string, any>(releases.map((r: any) => [r.tagName, r] as [string, any]));
    const v100 = relByTag.get('v1.0.0');
    expect(v100).toBeTruthy();
    expect(v100.draft).toBe(false);
    expect(v100.prerelease).toBe(false);
    expect(v100.publishedAt).toBe('2026-01-03T00:00:00Z');
    expect(v100.targetCommitish).toBe('main');
    expect(v100.assetCount).toBe(2);
    expect(v100.assetsTotalBytes).toBe(1280);
    expect(v100.htmlUrl).toContain('/releases/tag/v1.0.0');
    const rc = relByTag.get('v1.1.0-rc.1');
    expect(rc.prerelease).toBe(true);
    expect(rc.draft).toBe(false);
    expect(rc.targetCommitish).toBe('develop');
    const draftRel = relByTag.get('v2.0.0-draft');
    expect(draftRel.draft).toBe(true);
    expect(draftRel.publishedAt ?? null).toBeNull();

    // Tag inventory: plain tags (no release record) are present alongside
    // release-backed tags — the full paginated /tags list is stored.
    const tags = d.tags ?? [];
    expect(tags.length, 'all fixture tags inventoried').toBe(3);
    const tagByName = new Map<string, any>(tags.map((t: any) => [t.name, t] as [string, any]));
    expect(tagByName.get('nightly')?.sha).toBe(SHA_NIGHTLY);
    expect(tagByName.get('legacy-2025')).toBeTruthy();

    // Per-repo capability markers record the touched families.
    expect(d.capabilities?.branches?.status).toBe('OK');
    expect(d.capabilities?.versionInventory?.status).toBe('OK');

    // Instances: spec-011 semantics preserved — only mapping-classified
    // branches emit instances; env instance carries governance facts.
    const insts = alpha.instances ?? [];
    const externalIds = insts.map((i: any) => i.externalId);
    expect(externalIds).toContain('branch:develop');
    expect(externalIds).toContain('env:production');
    expect(externalIds).not.toContain('branch:main');
    expect(externalIds).not.toContain('branch:feature/checkout-flow');
    expect(externalIds).not.toContain('branch:dependabot/npm_and_yarn/lodash-4.17.21');

    const devInst = insts.find((i: any) => i.externalId === 'branch:develop');
    expect(devInst.environment).toBe('DEV');
    expect(devInst.rawConfig?.branch).toBe('develop');

    const prodInst = insts.find((i: any) => i.externalId === 'env:production');
    expect(prodInst.environment).toBe('PRODUCTION');
    const ghEnv = prodInst.rawConfig?.githubEnvironment;
    expect(ghEnv, 'env instance githubEnvironment block').toBeTruthy();
    expect(ghEnv.protectionRules).toHaveLength(2);
    expect(ghEnv.protectionRules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'wait_timer', waitTimerMinutes: 30 }),
        expect.objectContaining({ type: 'required_reviewers', preventSelfReview: true, reviewerCount: 2 }),
      ]),
    );
    expect(ghEnv.deploymentBranchPolicy).toMatchObject({
      protectedBranches: true,
      customBranchPolicies: false,
    });
    expect(ghEnv.canAdminsBypass).toBe(true);

    // svc-beta: default_branch is `trunk` — isDefault follows the repo
    // object, never a hardcoded main/master guess.
    const beta = await findRepo(api, 'pw-org/svc-beta');
    expect(beta, 'svc-beta repository component').toBeTruthy();
    const bd = beta.details ?? {};
    expect(bd.defaultBranch).toBe('trunk');
    const bBranches = bd.branches ?? [];
    expect(bBranches.map((b: any) => b.name).sort()).toEqual(['staging', 'trunk']);
    const trunk = bBranches.find((b: any) => b.name === 'trunk');
    expect(trunk.isDefault).toBe(true);
    expect(trunk.protected).toBe(true);
    expect(trunk.sha).toBe(SHA_TRUNK);
    const bStaging = bBranches.find((b: any) => b.name === 'staging');
    expect(bStaging.isDefault).toBe(false);
    expect((bd.releases ?? []).map((r: any) => r.tagName)).toContain('v0.9.0');
    expect((bd.tags ?? []).map((t: any) => t.name)).toContain('beta-2026-01');
    // svc-beta's `staging` branch still maps to a STAGING instance.
    expect((beta.instances ?? []).map((i: any) => i.externalId)).toContain('branch:staging');
  });

  test('component page renders the GitHub inventory sections', async ({ page, request }) => {
    await scenario('baseline');
    const api = await apiLogin(request, BASE, 'EDITOR');
    await runGithubImport(api);
    const alpha = await findRepo(api, 'pw-org/svc-alpha');
    expect(alpha?.slug).toBeTruthy();

    await loginPage(page, 'EDITOR');
    await page.goto(`/components/${alpha.slug}`);

    // Repository facts section.
    await expect(page.getByRole('heading', { name: 'Repository', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Default branch')).toBeVisible();
    await expect(page.getByText('Apache License 2.0')).toBeVisible();

    // Branches table — every fixture branch incl. unmapped names, with
    // default/protected badges and short SHAs.
    const branchesSection = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Branches', exact: true }),
    });
    await expect(branchesSection).toBeVisible();
    await expect(branchesSection.getByText('feature/checkout-flow')).toBeVisible();
    await expect(branchesSection.getByText('dependabot/npm_and_yarn/lodash-4.17.21')).toBeVisible();
    await expect(branchesSection.getByText('develop')).toBeVisible();
    await expect(branchesSection.getByText('main', { exact: true })).toBeVisible();
    await expect(branchesSection.getByText('default', { exact: true })).toBeVisible();
    await expect(branchesSection.getByText('protected', { exact: true }).first()).toBeVisible();
    await expect(branchesSection.getByText(SHA_MAIN.slice(0, 7))).toBeVisible();

    // Releases table — prerelease + draft badges distinguish the entries.
    const releasesSection = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Releases', exact: true }),
    });
    await expect(releasesSection).toBeVisible();
    await expect(releasesSection.getByText('v1.0.0', { exact: true })).toBeVisible();
    await expect(releasesSection.getByText('v1.1.0-rc.1')).toBeVisible();
    await expect(releasesSection.getByText('prerelease', { exact: true })).toBeVisible();
    await expect(releasesSection.getByText('draft', { exact: true })).toBeVisible();
    await expect(releasesSection.getByText('2 assets', { exact: false })).toBeVisible();

    // Tags table — plain tag without a release is listed.
    const tagsSection = page.locator('section').filter({
      has: page.getByRole('heading', { name: 'Tags', exact: true }),
    });
    await expect(tagsSection).toBeVisible();
    await expect(tagsSection.getByText('nightly', { exact: true })).toBeVisible();
    await expect(tagsSection.getByText('legacy-2025', { exact: true })).toBeVisible();

    // Environment instance expander renders the governance block. The
    // externalId `env:production` uniquely identifies the row.
    const prodRow = page.getByRole('row', { name: /env:production/ });
    await expect(prodRow).toBeVisible();
    await prodRow.getByRole('button', { name: 'Show details' }).click();
    await expect(page.getByRole('heading', { name: 'GitHub environment', exact: true })).toBeVisible();
    await expect(page.getByText('Wait timer — 30 min')).toBeVisible();
    await expect(page.getByText(/Required reviewers — 2 reviewers/)).toBeVisible();
    await expect(page.getByText('Deployment branch policy')).toBeVisible();
    await expect(page.getByText('Admins can bypass')).toBeVisible();
  });

  test('degraded GitHub capabilities surface markers and never fail the run', async ({ page, request }) => {
    await scenario('capability-failure');
    const api = await apiLogin(request, BASE, 'EDITOR');
    // triggerAndWait asserts COMPLETED — degradation must not fail the run.
    await runGithubImport(api);

    const alpha = await findRepo(api, 'pw-org/svc-alpha');
    expect(alpha, 'svc-alpha still emitted under capability-failure').toBeTruthy();
    const caps = alpha.details?.capabilities ?? {};
    for (const family of ['branches', 'versionInventory', 'environments']) {
      expect(caps[family]?.status, `capabilities.${family} marker`).toBeDefined();
      expect(caps[family]?.status, `capabilities.${family} degraded`).not.toBe('OK');
    }

    // The degraded markers render as a notice on the component page.
    await loginPage(page, 'EDITOR');
    await page.goto(`/components/${alpha.slug}`);
    await expect(page.getByText('Some GitHub inventory data is incomplete')).toBeVisible({ timeout: 15_000 });
  });
});
