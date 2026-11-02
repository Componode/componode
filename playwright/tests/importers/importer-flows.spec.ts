import { test, expect } from '@playwright/test';
import { apiLogin } from '../fixtures/auth.js';

const BASE = 'https://app.componode-pw.test';
const CTL = 'http://mock-control:9090';

async function scenario(target: string, name: string) {
  await fetch(`${CTL}/scenario/${target}`, { method: 'POST', body: JSON.stringify({ name }) });
}

async function triggerAndWait(api: any, configId: string): Promise<any> {
  const trig = await api('POST', `/api/v1/importer-configs/${configId}/trigger`, {});
  if (trig.status >= 400) throw new Error(`trigger failed ${trig.status}: ${JSON.stringify(trig.body)}`);
  const runId = trig.body.runId ?? trig.body.id;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const run = await api('GET', `/api/v1/importer-configs/${configId}/runs/${runId}`);
    const status = run.body.status ?? run.body.run?.status;
    if (status && !['PENDING', 'RUNNING'].includes(status)) return { status, run: run.body };
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('run timeout');
}

test.describe('importer run journeys', () => {
  test('all five seeded importer configs exist and run to completion', async ({ request }) => {
    const api = await apiLogin(request, BASE, 'EDITOR');
    const configs = await api('GET', '/api/v1/importer-configs');
    expect(configs.status).toBe(200);
    const list = configs.body.items ?? configs.body.configs ?? configs.body;
    const names = list.map((c: any) => c.importerName ?? c.importer);
    for (const expected of ['github', 'alibaba-cloud', 'docker', 'web-url', 'api-url']) {
      expect(names, expected).toContain(expected);
    }
  });

  test('web-url and api-url runs complete against the local fixture', async ({ request }) => {
    await scenario('mock-url-importers', 'baseline');
    const api = await apiLogin(request, BASE, 'EDITOR');
    const configs = await api('GET', '/api/v1/importer-configs');
    const list = configs.body.items ?? configs.body.configs ?? configs.body;
    for (const name of ['web-url', 'api-url']) {
      const cfg = list.find((c: any) => (c.importerName ?? c.importer) === name);
      const { status } = await triggerAndWait(api, cfg.id);
      expect(status, name).toBe('COMPLETED');
    }
  });

  test('docker importer run completes against the mTLS engine fake', async ({ request }) => {
    await scenario('mock-docker-engine', 'baseline');
    const api = await apiLogin(request, BASE, 'EDITOR');
    const configs = await api('GET', '/api/v1/importer-configs');
    const list = configs.body.items ?? configs.body.configs ?? configs.body;
    const cfg = list.find((c: any) => (c.importerName ?? c.importer) === 'docker');
    const { status } = await triggerAndWait(api, cfg.id);
    expect(status).toBe('COMPLETED');
  });

  test('alibaba run completes with provider mapping', async ({ request }) => {
    await scenario('mock-alibaba', 'baseline');
    const api = await apiLogin(request, BASE, 'EDITOR');
    const configs = await api('GET', '/api/v1/importer-configs');
    const list = configs.body.items ?? configs.body.configs ?? configs.body;
    const cfg = list.find((c: any) => (c.importerName ?? c.importer) === 'alibaba-cloud');
    const { status } = await triggerAndWait(api, cfg.id);
    expect(status).toBe('COMPLETED');
  });
});
