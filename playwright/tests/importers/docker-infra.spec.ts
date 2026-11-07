import { test, expect } from '@playwright/test';
import { apiLogin, loginPage } from '../fixtures/auth.js';

const BASE = 'https://app.componode-pw.test';
const CTL = 'http://mock-control:9090';

async function scenario(name: string) {
  await fetch(`${CTL}/scenario/mock-docker-engine`, { method: 'POST', body: JSON.stringify({ name }) });
}

async function triggerAndWait(api: any, configId: string): Promise<string> {
  const trig = await api('POST', `/api/v1/importer-configs/${configId}/trigger`, {});
  if (trig.status >= 400) throw new Error(`trigger failed ${trig.status}: ${JSON.stringify(trig.body)}`);
  const runId = trig.body.runId ?? trig.body.id;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const run = await api('GET', `/api/v1/importer-configs/${configId}/runs/${runId}`);
    const status = run.body.status ?? run.body.run?.status;
    if (status && !['PENDING', 'RUNNING'].includes(status)) {
      expect(status, `run ${runId}`).toBe('COMPLETED');
      return status;
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

async function dockerComponents(api: any): Promise<any[]> {
  const res = await api('GET', '/api/v1/components?provider=DOCKER&pageSize=100');
  expect(res.status).toBe(200);
  return res.body.data ?? res.body.items ?? res.body.components ?? res.body;
}

async function componentDetail(api: any, id: string): Promise<any> {
  const res = await api('GET', `/api/v1/components/${id}`);
  expect(res.status).toBe(200);
  return res.body.component;
}

test.describe('docker importer infra inventory (spec 065)', () => {
  test('baseline run emits bounded NETWORK and STORAGE components', async ({ request }) => {
    await scenario('baseline');
    const api = await apiLogin(request, BASE, 'EDITOR');
    await runDockerImport(api);

    const list = await dockerComponents(api);

    // ---- networks ----
    const networks = list.filter((c: any) => c.resourceType === 'network');
    expect(networks.map((c: any) => c.name).sort()).toEqual(['bridge', 'pw-overlay']);
    for (const n of networks) {
      const detail = await componentDetail(api, n.id);
      expect(detail.category).toBe('NETWORK');
      expect(detail.provider).toBe('DOCKER');
      expect(detail.instances ?? []).toEqual([]);
      expect(detail.externalId).toContain('::network:');
    }

    const overlayItem = networks.find((c: any) => c.name === 'pw-overlay');
    const overlay = await componentDetail(api, overlayItem.id);
    expect(overlay.externalId).toContain('::network:swarm:pw-overlay');
    const od = overlay.details ?? {};
    expect(od.driver).toBe('overlay');
    expect(od.scope).toBe('swarm');
    expect(od.internal).toBe(true);
    expect(od.attachable).toBe(true);
    expect(od.ingress).toBe(true);
    expect(od.attachedCount).toBe(2);
    expect(od.attachedContainers).toEqual(['pw-web', 'pw-worker']);
    expect(od.labels).toEqual({ 'com.docker.compose.project': 'pw-app' });
    // Excluded network fields never leave the boundary.
    const odJson = JSON.stringify(od);
    for (const banned of [
      'IPAM', '10.90.0.0/24', '10.90.0.1', 'Options', 'docker.network.driver',
      'ep-aaa-secret', 'ep-bbb-secret', '02:42:ac', '10.90.0.2', '172.17.0.0/16',
      'com.acme.internal', 'drop-me',
    ]) {
      expect(odJson, `network details leak ${banned}`).not.toContain(banned);
    }

    const bridgeItem = networks.find((c: any) => c.name === 'bridge');
    const bridge = await componentDetail(api, bridgeItem.id);
    expect(bridge.externalId).toContain('::network:local:bridge');
    expect(bridge.details.scope).toBe('local');
    expect(bridge.details.driver).toBe('bridge');
    expect(bridge.details.attachedCount).toBe(1);
    expect(bridge.details.attachedContainers).toEqual(['pw-standalone']);
    expect(bridge.details.labels).toBeUndefined();

    // ---- volumes ----
    const volumes = list.filter((c: any) => c.resourceType === 'volume');
    expect(volumes.map((c: any) => c.name).sort()).toEqual(['pw-cache', 'pw-data', 'pw-orphan']);
    for (const v of volumes) {
      const detail = await componentDetail(api, v.id);
      expect(detail.category).toBe('STORAGE');
      expect(detail.provider).toBe('DOCKER');
      expect(detail.instances ?? []).toEqual([]);
      expect(detail.externalId).toContain('::volume:');
    }

    const dataItem = volumes.find((c: any) => c.name === 'pw-data');
    const data = await componentDetail(api, dataItem.id);
    expect(data.externalId).toContain('::volume:pw-data');
    const dd = data.details ?? {};
    expect(dd.driver).toBe('local');
    expect(dd.scope).toBe('local');
    expect(dd.sizeBytes).toBe(5242880);
    expect(dd.refCount).toBe(2);
    expect(dd.reclaimable).toBe(true);
    expect(dd.labels).toEqual({ 'com.docker.compose.project': 'pw-app' });
    // Excluded volume fields never leave the boundary.
    const ddJson = JSON.stringify(dd);
    for (const banned of [
      'Mountpoint', '/var/lib/docker/volumes', 'Options', ':/srv/pw',
      '10.9.9.9', 'Status', 'working_dir',
    ]) {
      expect(ddJson, `volume details leak ${banned}`).not.toContain(banned);
    }

    const cacheItem = volumes.find((c: any) => c.name === 'pw-cache');
    const cache = await componentDetail(api, cacheItem.id);
    // -1 UsageData sentinels omit usage fields entirely.
    expect(cache.details.sizeBytes).toBeUndefined();
    expect(cache.details.refCount).toBeUndefined();
    expect(cache.details.reclaimable).toBeUndefined();
    expect(cache.details.driver).toBe('local');

    // pw-orphan has no /system/df entry — usage fields omitted as well.
    const orphanItem = volumes.find((c: any) => c.name === 'pw-orphan');
    const orphan = await componentDetail(api, orphanItem.id);
    expect(orphan.details.sizeBytes).toBeUndefined();
    expect(orphan.details.refCount).toBeUndefined();
    expect(orphan.details.driver).toBe('local');
  });

  test('component detail renders named Network and Volume sections', async ({ page, request }) => {
    await scenario('baseline');
    const api = await apiLogin(request, BASE, 'EDITOR');
    await runDockerImport(api);

    const list = await dockerComponents(api);
    const overlayItem = list.find((c: any) => c.resourceType === 'network' && c.name === 'pw-overlay');
    await loginPage(page, 'EDITOR');
    await page.goto(`/components/${overlayItem.slug}`);
    await expect(page.getByRole('heading', { name: 'Network', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('overlay', { exact: true })).toBeVisible();
    await expect(page.getByText('pw-web').first()).toBeVisible();
    await expect(page.getByText('pw-worker').first()).toBeVisible();
    // Excluded sentinels never render.
    await expect(page.getByText(/10\.90\.0\.0\/24/)).toHaveCount(0);
    await expect(page.getByText(/ep-aaa-secret/)).toHaveCount(0);

    const dataItem = list.find((c: any) => c.resourceType === 'volume' && c.name === 'pw-data');
    await page.goto(`/components/${dataItem.slug}`);
    await expect(page.getByRole('heading', { name: 'Volume', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('5.0 MiB')).toBeVisible();
    await expect(page.getByText('pw-app')).toBeVisible();
    await expect(page.getByText(/\/var\/lib\/docker\/volumes/)).toHaveCount(0);
  });
});
