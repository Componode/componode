import { test, expect } from '@playwright/test';
import { apiLogin } from '../fixtures/auth.js';

const BASE = 'https://app.componode-pw.test';
const uid = () => `pw-fi-${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

async function makeComponent(api: any, slug: string, withInstance = false) {
  const body: any = {
    name: `PW FI ${slug}`, slug, category: 'API', provider: 'OTHER', resourceType: 'pw-fi',
  };
  if (withInstance) body.instance = { environment: 'PRODUCTION' };
  const res = await api('POST', '/api/v1/components', body);
  return res.body.id ?? res.body.component?.id;
}

test.describe('first-instance recovery (054)', () => {
  test('editor adds first instance to active zero-instance component', async ({ request }) => {
    const api = await apiLogin(request, BASE, 'EDITOR');
    const id = await makeComponent(api, uid());
    const res = await api('POST', `/api/v1/components/${id}/instances`, { environment: 'TEST' });
    expect(res.status).toBe(201);
    expect(res.body.instance.status).toBe('RUNNING');
    expect(res.body.instance.externalId).toMatch(/^manual:/);
  });

  test('second instance through the recovery endpoint conflicts', async ({ request }) => {
    const api = await apiLogin(request, BASE, 'EDITOR');
    const id = await makeComponent(api, uid());
    await api('POST', `/api/v1/components/${id}/instances`, { environment: 'TEST' });
    const dup = await api('POST', `/api/v1/components/${id}/instances`, { environment: 'DEV' });
    expect(dup.status).toBe(409);
  });

  test('invalid input, missing component, unauthenticated, and role denial', async ({ request }) => {
    const api = await apiLogin(request, BASE, 'EDITOR');
    const viewer = await apiLogin(request, BASE, 'VIEWER');
    const id = await makeComponent(api, uid());

    expect((await api('POST', `/api/v1/components/${id}/instances`, { environment: 'BOGUS' })).status).toBe(400);
    expect((await api('POST', `/api/v1/components/00000000-0000-0000-0000-000000000000/instances`, { environment: 'DEV' })).status).toBe(404);
    expect((await viewer('POST', `/api/v1/components/${id}/instances`, { environment: 'DEV' })).status).toBe(403);

    const anonNoCsrf = await request.fetch(`${BASE}/api/v1/components/${id}/instances`, { method: 'POST', data: { environment: 'DEV' } });
    expect([401, 403]).toContain(anonNoCsrf.status());
    const pre = await request.get(`${BASE}/api/v1/auth/session`);
    const csrf = ((pre.headers()['set-cookie'] ?? '') + '').match(/componode_csrf=([^;]+)/)?.[1] ?? '';
    const anon = await request.fetch(`${BASE}/api/v1/components/${id}/instances`, {
      method: 'POST', data: { environment: 'DEV' },
      headers: { 'x-csrf-token': csrf },
    });
    expect(anon.status()).toBe(401);
  });

  test('retired component is denied', async ({ request }) => {
    const api = await apiLogin(request, BASE, 'EDITOR');
    // Retirement is reconciliation-driven — use the seeded RETIRED fixture.
    const list = await api('GET', '/api/v1/components?lifecycle=RETIRED&includeRetired=true&pageSize=1');
    const retired = (list.body.data ?? list.body.components ?? list.body.items ?? list.body)[0];
    expect(retired).toBeTruthy();
    const res = await api('POST', `/api/v1/components/${retired.id}/instances`, { environment: 'DEV' });
    expect([403, 404]).toContain(res.status);
  });
});
