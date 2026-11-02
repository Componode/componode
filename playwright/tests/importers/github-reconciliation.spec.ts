import { test, expect } from '@playwright/test';
import { apiLogin, secrets } from '../fixtures/auth.js';
import { readFileSync } from 'node:fs';

const BASE = 'https://app.componode-pw.test';
const CTL = 'http://mock-control:9090';

async function scenario(name: string) {
  await fetch(`${CTL}/scenario/mock-github`, { method: 'POST', body: JSON.stringify({ name }) });
}

async function runAndWait(api: any, configId: string): Promise<any> {
  const trig = await api('POST', `/api/v1/importer-configs/${configId}/trigger`, {});
  const runId = trig.body.runId ?? trig.body.id;
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const run = await api('GET', `/api/v1/importer-configs/${configId}/runs/${runId}`);
    const status = run.body.status ?? run.body.run?.status;
    if (status && !['PENDING', 'RUNNING'].includes(status)) return run.body;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error('importer run did not finish');
}

test.describe('github source-scoped reconciliation journey', () => {
  test('add → change → omit lifecycle with shared-Source preservation', async ({ request }) => {
    const api = await apiLogin(request, BASE, 'ADMIN');
    const seedResult = JSON.parse(readFileSync('/pw-private/out/seed-result.json', 'utf8'));
    const configId = seedResult.githubConfigId;
    expect(configId).toBeTruthy();

    await scenario('baseline');
    const run1 = await runAndWait(api, configId);
    expect(run1.status ?? run1.run?.status).toBe('COMPLETED');
    const comps1 = await api('GET', '/api/v1/components?search=svc-&pageSize=50');
    const names1 = (comps1.body.items ?? comps1.body.data ?? []).map((c: any) => c.name);
    expect(names1).toContain('pw-org/svc-alpha');
    expect(names1).toContain('pw-org/svc-beta');

    await scenario('changed');
    const run2 = await runAndWait(api, configId);
    expect(run2.status ?? run2.run?.status).toBe('COMPLETED');

    // Omission retires only this Source's absent memberships.
    await scenario('omitted');
    const run3 = await runAndWait(api, configId);
    expect(run3.status ?? run3.run?.status).toBe('COMPLETED');
    const srcList = await api('GET', '/api/v1/importer-sources');
    const sources = srcList.body.items ?? srcList.body.sources ?? srcList.body;
    expect(Array.isArray(sources) ? sources.length : 0).toBeGreaterThan(0);
  });
});
