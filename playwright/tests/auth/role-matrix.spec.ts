import { test, expect } from '@playwright/test';
import { apiLogin, loginPage } from '../fixtures/auth.js';

const BASE = 'https://app.componode-pw.test';
const uid = () => `pw-r-${Date.now().toString(36)}`;

test.describe('role boundary matrix', () => {
  test('viewer reads catalog but cannot write anywhere', async ({ request }) => {
    const v = await apiLogin(request, BASE, 'VIEWER');
    expect((await v('GET', '/api/v1/components?page=1&pageSize=5')).status).toBe(200);
    for (const [method, path, body] of [
      ['POST', '/api/v1/components', { name: 'x', slug: uid(), category: 'API', provider: 'OTHER', resourceType: 'x' }],
      ['POST', '/api/v1/products', { name: 'x', slug: uid(), type: 'PLATFORM' }],
      ['POST', '/api/v1/credentials', { label: 'x', secrets: { k: 'v' } }],
      ['POST', '/api/v1/users', { username: uid(), password: 'Pw!12345678', role: 'VIEWER' }],
    ] as const) {
      const r = await v(method, path, body);
      expect(r.status, `${method} ${path}`).toBe(403);
    }
  });

  test('editor writes catalog but not admin-only surfaces', async ({ request }) => {
    const e = await apiLogin(request, BASE, 'EDITOR');
    const comp = await e('POST', '/api/v1/components', {
      name: `PW Editor ${uid()}`, slug: uid(), category: 'API', provider: 'OTHER', resourceType: 'pw',
    });
    expect(comp.status).toBe(201);
    for (const [method, path, body] of [
      ['POST', '/api/v1/credentials', { label: 'x', secrets: { k: 'v' } }],
      ['POST', '/api/v1/users', { username: uid(), password: 'Pw!12345678', role: 'VIEWER' }],
      ['POST', '/api/v1/docker-targets', { targetId: 'x', label: 'x', profile: { transport: 'tcp', host: 'x', clientCertKey: 'a', clientKeyKey: 'b' } }],
      ['PUT', '/api/v1/settings', { allowSelfRegistration: true }],
    ] as const) {
      const r = await e(method, path, body);
      expect(r.status, `${method} ${path}`).toBe(403);
    }
  });

  test('admin routes are denied to editor and viewer in the API', async ({ request }) => {
    const e = await apiLogin(request, BASE, 'EDITOR');
    const v = await apiLogin(request, BASE, 'VIEWER');
    for (const [api, role] of [[e, 'editor'], [v, 'viewer']] as const) {
      const agents = await api('POST', '/api/v1/agents', { name: `pw-deny-${role}` });
      expect(agents.status, `${role} create agent`).toBe(403);
      const users = await api('GET', '/api/v1/users');
      expect(users.status, `${role} list users`).toBe(403);
    }
  });

  test('role-aware navigation: admin-only nav hidden from viewer', async ({ page }) => {
    await loginPage(page, 'VIEWER');
    await page.goto('/');
    // Viewer should not see Users/Agents/Credentials nav entries.
    for (const label of ['Users', 'Import Agents', 'Credentials', 'Docker Targets']) {
      const link = page.getByRole('link', { name: new RegExp(label, 'i') });
      expect(await link.count(), label).toBe(0);
    }
  });
});
