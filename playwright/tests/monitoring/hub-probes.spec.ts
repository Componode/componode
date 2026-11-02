import { test, expect } from '@playwright/test';
import { apiLogin } from '../fixtures/auth.js';
import { readFileSync } from 'node:fs';

const BASE = 'https://app.componode-pw.test';
const CTL = 'http://mock-control:9090';

function seeded() {
  return JSON.parse(readFileSync('/pw-private/out/seed-result.json', 'utf8'));
}

test.describe('hub probe observations (four auth modes)', () => {
  test('mock target records matching auth for BASIC, BEARER, CUSTOM_HEADERS', async ({ request }) => {
    test.setTimeout(100_000);
    const api = await apiLogin(request, BASE, 'ADMIN');
    // Earlier specs may have flipped the probe component to AGENT vantage or
    // left cadence elevated — restore HUB vantage, then re-arm every check
    // (PATCH enabled resets nextProbeAt to now) so probes fire promptly.
    const { probeComponentId } = seeded();
    await api('PUT', `/api/v1/components/${probeComponentId}/monitoring-setup`, { vantage: 'HUB', agentId: null, cadenceSeconds: 60 });
    const checksRes = await api('GET', `/api/v1/components/${probeComponentId}/url-checks`);
    for (const check of checksRes.body.checks ?? []) {
      await api('PATCH', `/api/v1/url-checks/${check.id}`, { enabled: true });
    }
    await fetch(`${CTL}/reset/mock-url-check-target`, { method: 'POST' });

    const deadline = Date.now() + 75_000;
    let probes: any[] = [];
    while (Date.now() < deadline) {
      const res = await fetch(`${CTL}/requests/mock-url-check-target`);
      const body = await res.json();
      probes = body.requests ?? [];
      const paths = probes.map((p: any) => p.path);
      if (['/none', '/basic', '/bearer', '/custom'].every((p) => paths.includes(p))) break;
      await new Promise((r) => setTimeout(r, 2000));
    }

    const byPath = (p: string) => probes.filter((r: any) => r.path === p);
    expect(byPath('/none').length).toBeGreaterThan(0);
    expect(byPath('/basic').some((r: any) => r.authMatch === true)).toBeTruthy();
    expect(byPath('/bearer').some((r: any) => r.authMatch === true)).toBeTruthy();
    expect(byPath('/custom').some((r: any) => r.authMatch === true)).toBeTruthy();

    // Recorded headers never include raw credential values — only names.
    for (const r of probes) {
      expect(JSON.stringify(r)).not.toMatch(/PWP_|Bearer pw-t|Basic [A-Za-z0-9+/=]{8,}/);
    }
  });

  test('observations are visible through the API', async ({ request }) => {
    const api = await apiLogin(request, BASE, 'ADMIN');
    const compId = JSON.parse(readFileSync('/pw-private/out/seed-result.json', 'utf8')).probeComponentId;
    const checks = await api('GET', `/api/v1/components/${compId}/url-checks`);
    const list = checks.body.checks ?? checks.body.items ?? checks.body;
    expect(list.length).toBeGreaterThan(0);
    const obs = await api('GET', `/api/v1/url-checks/${list[0].id}/observations`);
    expect(obs.status).toBe(200);
  });
});
