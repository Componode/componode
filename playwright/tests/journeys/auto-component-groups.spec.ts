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

async function autoGroup(api: any): Promise<any> {
  const res = await api('GET', '/api/v1/component-groups?pageSize=100');
  expect(res.status).toBe(200);
  const list = res.body.groups ?? res.body.data ?? res.body.items ?? res.body;
  const group = list.find((g: any) => typeof g.slug === 'string' && g.slug.startsWith('docker-cluster-'));
  if (!group) throw new Error('no docker-cluster-* auto-group found');
  return group;
}

// Spec 067: a completed docker run provisions one source-scoped auto-group
// whose membership is the source's sole-reported components; the group is an
// ordinary ComponentGroup for reads/UI but rejects human lifecycle writes
// and deletion with 409 GROUP_AUTO_MANAGED.
test.describe('source auto ComponentGroups (spec 067)', () => {
  test('docker run provisions a discoverable auto-group with derived membership', async ({ page, request }) => {
    await scenario('baseline');
    const api = await apiLogin(request, BASE, 'EDITOR');
    await triggerAndWait(api, await dockerConfigId(api));

    const group = await autoGroup(api);
    expect(group.name).toBeTruthy();
    expect(group.slug).toMatch(/^docker-cluster-[0-9a-f]{12}/);
    expect(group.teamOwnerId ?? null).toBeNull();

    // Members = components filtered by the group slug (the list contract).
    const members = await api('GET', `/api/v1/components?group=${group.slug}&pageSize=100`);
    expect(members.status).toBe(200);
    const rows = members.body.data ?? members.body.items ?? members.body.components ?? members.body;
    expect(rows.length).toBeGreaterThan(0);
    // Known baseline containers are sole-reported → grouped.
    const names = rows.map((c: any) => c.name);
    expect(names).toContain('pw-web');

    // Detail page renders the auto-group like any other group.
    await loginPage(page, 'EDITOR');
    await page.goto(`/component-groups/${group.slug}`);
    await expect(page.getByText(group.name).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('pw-web').first()).toBeVisible();

    // Human lifecycle write → controlled conflict.
    const lifecycle = await api('PATCH', `/api/v1/component-groups/${group.id}`, { lifecycle: 'RETIRED' });
    expect(lifecycle.status).toBe(409);
    expect(lifecycle.body.code).toBe('GROUP_AUTO_MANAGED');

    // Human delete → same controlled conflict.
    const del = await api('DELETE', `/api/v1/component-groups/${group.id}`);
    expect(del.status).toBe(409);
    expect(del.body.code).toBe('GROUP_AUTO_MANAGED');

    // Name edits stay allowed.
    const renamed = `PW Auto ${Date.now().toString(36)}`;
    const rename = await api('PATCH', `/api/v1/component-groups/${group.id}`, { name: renamed });
    expect(rename.status).toBe(200);
    const detail = await api('GET', `/api/v1/component-groups/${group.id}`);
    expect(detail.body.group.name).toBe(renamed);
  });
});
