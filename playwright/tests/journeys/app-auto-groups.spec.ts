import { test, expect } from '@playwright/test';
import { apiLogin, loginPage } from '../fixtures/auth.js';

const BASE = 'https://app.componode-pw.test';
const CTL = 'http://mock-control:9090';

async function scenario(name: string) {
  await fetch(`${CTL}/scenario/mock-docker-engine`, { method: 'POST', body: JSON.stringify({ name }) });
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

async function dockerConfigId(api: any): Promise<string> {
  const configs = await api('GET', '/api/v1/importer-configs');
  const list = configs.body.items ?? configs.body.configs ?? configs.body.data ?? configs.body;
  const cfg = list.find((c: any) => (c.importerName ?? c.importer) === 'docker');
  if (!cfg) throw new Error('no docker importer config seeded');
  return cfg.id;
}

async function runDockerImport(api: any) {
  await triggerAndWait(api, await dockerConfigId(api));
}

async function appGroups(api: any): Promise<any[]> {
  const res = await api('GET', '/api/v1/component-groups?pageSize=100');
  expect(res.status).toBe(200);
  const list = res.body.groups ?? res.body.data ?? res.body.items ?? res.body;
  return list.filter((g: any) => typeof g.autoGroupKey === 'string' && g.autoGroupKey.length > 0);
}

async function groupMembers(api: any, groupSlug: string): Promise<any[]> {
  const res = await api('GET', `/api/v1/components?group=${groupSlug}&pageSize=100`);
  expect(res.status).toBe(200);
  return res.body.data ?? res.body.items ?? res.body.components ?? res.body;
}

async function dockerComponents(api: any): Promise<any[]> {
  const res = await api('GET', '/api/v1/components?provider=DOCKER&pageSize=100');
  expect(res.status).toBe(200);
  return res.body.data ?? res.body.items ?? res.body.components ?? res.body;
}

const uid = () => `pw-ag-${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;

// Spec 070: Docker imports provision app-level auto ComponentGroups — one
// per (source, compose project | swarm stack). Membership is the reported
// components carrying the boundary label; groups are additive alongside
// source + human groups and automation-owned like source groups.
test.describe('docker app auto ComponentGroups (spec 070)', () => {
  test('baseline run provisions a compose-project app group with exact members', async ({ page, request }) => {
    await scenario('baseline');
    const api = await apiLogin(request, BASE, 'EDITOR');
    await runDockerImport(api);

    const groups = await appGroups(api);
    const app = groups.find((g: any) => g.autoGroupKey === 'compose:pw-app');
    expect(app, 'compose:pw-app app group').toBeTruthy();
    expect(app.name).toBe('pw-app');
    expect(app.slug).toMatch(/^docker-app-pw-app-[0-9a-f]{12}$/);
    expect(app.autoSourceId).toBeTruthy();

    // Both browser projects share one database — a previous project's run
    // may have assigned an owner (auto groups accept owner writes). Normalize
    // before asserting the provisioning default.
    const reset = await api('PATCH', `/api/v1/component-groups/${app.id}`, { teamOwnerId: null });
    expect(reset.status).toBe(200);
    const fresh = await api('GET', `/api/v1/component-groups/${app.id}`);
    expect(fresh.body.group.teamOwnerId ?? null).toBeNull();

    // Exact member set: the compose workload (pw-app/worker) plus the
    // label-carrying network + volume. pw-web (standalone), unlabeled
    // infra (bridge, pw-cache, pw-orphan), images, and the engine stay
    // source-group-only.
    const members = await groupMembers(api, app.slug);
    const names = members.map((c: any) => c.name).sort();
    expect(names).toEqual(['pw-app/worker', 'pw-data', 'pw-overlay']);

    // Guards: lifecycle writes and deletes are controlled conflicts;
    // human field edits stay allowed (covered by the source-group spec).
    const lifecycle = await api('PATCH', `/api/v1/component-groups/${app.id}`, { lifecycle: 'RETIRED' });
    expect(lifecycle.status).toBe(409);
    expect(lifecycle.body.code).toBe('GROUP_AUTO_MANAGED');
    const del = await api('DELETE', `/api/v1/component-groups/${app.id}`);
    expect(del.status).toBe(409);
    expect(del.body.code).toBe('GROUP_AUTO_MANAGED');

    // Group detail page renders like any other group. The owner team is
    // created before navigation so the page's teams query includes it.
    const teamName = `PW AppTeam ${uid()}`;
    const team = await api('POST', '/api/v1/teams', { name: teamName });
    expect(team.status).toBe(201);
    const teamId = team.body.team?.id ?? team.body.id;

    await loginPage(page, 'EDITOR');
    await page.goto(`/component-groups/${app.slug}`);
    await expect(page.getByText('pw-app').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('pw-overlay').first()).toBeVisible();
    await expect(page.getByText('pw-data').first()).toBeVisible();
    await expect(page.getByText('pw-app/worker').first()).toBeVisible();
    await expect(page.getByText('pw-web')).toHaveCount(0);

    // Auto-managed edit surface: delete is never offered, and the edit
    // dialog exposes only name + owning team — derived fields
    // (description, lifecycle) are not submitted, so saves can't trip
    // GROUP_AUTO_MANAGED (bugfix on spec 070).
    await expect(page.getByRole('button', { name: 'Delete group' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Edit group' }).click();
    await expect(page.getByLabel('Owning team')).toBeVisible();
    await expect(page.getByLabel('Lifecycle')).toHaveCount(0);
    await expect(page.locator('#edit-group-desc')).toHaveCount(0);

    // Owner assignment persists — the reported failure mode.
    await page.getByLabel('Owning team').click();
    await page.getByRole('option', { name: teamName }).click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Group updated')).toBeVisible({ timeout: 10_000 });
    const after = await api('GET', `/api/v1/component-groups/${app.id}`);
    expect(after.body.group.teamOwnerId).toBe(teamId);
  });

  test('swarm run provisions a stack app group for labeled services', async ({ request }) => {
    await scenario('swarm');
    const api = await apiLogin(request, BASE, 'EDITOR');
    await runDockerImport(api);

    const groups = await appGroups(api);
    const stack = groups.find((g: any) => g.autoGroupKey === 'stack:pw-stack');
    expect(stack, 'stack:pw-stack app group').toBeTruthy();
    expect(stack.name).toBe('pw-stack');
    expect(stack.slug).toMatch(/^docker-app-pw-stack-[0-9a-f]{12}$/);

    // Only pw-svc carries the stack namespace label; pw-batch does not.
    const members = await groupMembers(api, stack.slug);
    expect(members.map((c: any) => c.name)).toEqual(['pw-svc']);
  });

  test('component holds human + source + app memberships; picker shows only human groups', async ({ page, request }) => {
    await scenario('baseline');
    const api = await apiLogin(request, BASE, 'EDITOR');
    await runDockerImport(api);

    // pw-overlay is reported with the compose label → source group + app
    // group memberships, both automation-owned.
    const comps = await dockerComponents(api);
    const overlay = comps.find((c: any) => c.resourceType === 'network' && c.name === 'pw-overlay');
    expect(overlay, 'pw-overlay component').toBeTruthy();
    const overlayDetail = await api('GET', `/api/v1/components/${overlay.id}`);
    const autoRefs = (overlayDetail.body.component.componentGroups ?? []).filter(
      (g: any) => g.autoSourceId,
    );
    expect(autoRefs.length).toBeGreaterThanOrEqual(2);
    expect(autoRefs.some((g: any) => g.autoGroupKey === 'compose:pw-app')).toBe(true);

    // Two human groups for the multi-assign flow.
    const run = uid();
    const g1 = await api('POST', '/api/v1/component-groups', { name: `PW GA ${run}`, slug: `pw-ga-${run}-a` });
    const g2 = await api('POST', '/api/v1/component-groups', { name: `PW GB ${run}`, slug: `pw-ga-${run}-b` });
    expect(g1.status).toBe(201);
    expect(g2.status).toBe(201);
    const g1Id = g1.body.group.id;
    const g2Id = g2.body.group.id;

    // Edit dialog on the auto-grouped component: auto memberships render
    // read-only and are NOT picker options; human checkboxes assign both.
    await loginPage(page, 'EDITOR');
    await page.goto(`/components/${overlay.slug}`);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await expect(page.getByText('Auto-managed:')).toBeVisible({ timeout: 10_000 });
    // The app group's checkbox must not exist — automation owns it.
    const appGroup = (await appGroups(api)).find((g: any) => g.autoGroupKey === 'compose:pw-app');
    await expect(page.locator(`#ce-group-${appGroup.id}`)).toHaveCount(0);

    await page.locator(`#ce-group-${g1Id}`).click();
    await page.locator(`#ce-group-${g2Id}`).click();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Component updated')).toBeVisible({ timeout: 10_000 });

    // Data integrity: human memberships added; auto memberships untouched.
    const after = await api('GET', `/api/v1/components/${overlay.id}`);
    const groupIds = (after.body.component.componentGroups ?? []).map((g: any) => g.id);
    expect(groupIds).toContain(g1Id);
    expect(groupIds).toContain(g2Id);
    expect(groupIds).toContain(appGroup.id);
    const autoAfter = (after.body.component.componentGroups ?? []).filter((g: any) => g.autoSourceId);
    expect(autoAfter.length).toBe(autoRefs.length);

    // The component now appears as a member on BOTH human group pages —
    // the group=<slug> filter matches any membership.
    for (const [gid, slug] of [[g1Id, `pw-ga-${run}-a`], [g2Id, `pw-ga-${run}-b`]] as const) {
      const members = await groupMembers(api, slug);
      expect(members.map((c: any) => c.id)).toContain(overlay.id);
      void gid;
    }
    await page.goto(`/component-groups/pw-ga-${run}-a`);
    await expect(page.getByText('pw-overlay').first()).toBeVisible({ timeout: 15_000 });
    await page.goto(`/component-groups/pw-ga-${run}-b`);
    await expect(page.getByText('pw-overlay').first()).toBeVisible({ timeout: 15_000 });
  });
});
