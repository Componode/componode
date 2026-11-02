import { test, expect } from '@playwright/test';
import { apiLogin, secrets } from '../fixtures/auth.js';

const BASE = 'https://app.componode-pw.test';
const SECRET_KEYS = [
  'PWP_ADMIN_PASSWORD', 'PWP_EDITOR_PASSWORD', 'PWP_VIEWER_PASSWORD',
  'PWP_GITHUB_TOKEN', 'PWP_ALIBABA_ACCESS_KEY_SECRET', 'PWP_OIDC_CLIENT_SECRET',
  'PWP_DEX_USER_PASSWORD', 'PWP_COOKIE_SECRET', 'PWP_POSTGRES_PASSWORD',
  'PWP_URLCHECK_BASIC_PASSWORD', 'PWP_URLCHECK_BEARER_TOKEN', 'PWP_URLCHECK_HEADER_VALUE',
];

test.describe('no secret values in ordinary outputs', () => {
  test('API responses never echo credential values', async ({ request }) => {
    const s = secrets();
    const api = await apiLogin(request, BASE, 'ADMIN');
    for (const path of [
      '/api/v1/credentials', '/api/v1/importer-configs', '/api/v1/agents',
      '/api/v1/settings', '/api/v1/auth/session',
    ]) {
      const res = await api('GET', path);
      const text = JSON.stringify(res.body);
      for (const key of SECRET_KEYS) {
        expect(text, `${path} leaks ${key}`).not.toContain(s[key] ?? 'never-matches');
      }
    }
  });

  test('login page HTML contains no secret material', async ({ page }) => {
    const s = secrets();
    await page.goto('/login');
    const html = await page.content();
    for (const key of SECRET_KEYS) {
      expect(html).not.toContain(s[key] ?? 'never-matches');
    }
  });

  test('mock control endpoints never return auth header values', async () => {
    const s = secrets();
    const res = await fetch('http://mock-control:9090/requests/mock-url-check-target');
    const text = await res.text();
    for (const key of SECRET_KEYS) {
      expect(text).not.toContain(s[key] ?? 'never-matches');
    }
  });
});
