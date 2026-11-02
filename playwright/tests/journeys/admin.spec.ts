import { test, expect } from '@playwright/test';
import { loginPage, apiLogin, secrets } from '../fixtures/auth.js';

const BASE = 'https://app.componode-pw.test';
const uid = () => `pw-a-${Date.now().toString(36)}`;

test.describe('admin journeys', () => {
  test('credential CRUD keeps secrets write-only', async ({ request }) => {
    const api = await apiLogin(request, BASE, 'ADMIN');
    const cred = await api('POST', '/api/v1/credentials', {
      label: `pw-cred-${uid()}`, secrets: { apiKey: 'pw-secret-value' },
    });
    expect(cred.status).toBe(201);
    const listed = await api('GET', '/api/v1/credentials');
    const text = JSON.stringify(listed.body);
    expect(text).not.toContain('pw-secret-value');
  });

  test('admin toggles self-registration setting', async ({ request }) => {
    const api = await apiLogin(request, BASE, 'ADMIN');
    const on = await api('PATCH', '/api/v1/settings', { allowSelfRegistration: true });
    expect(on.status).toBe(200);
    const off = await api('PATCH', '/api/v1/settings', { allowSelfRegistration: false });
    expect(off.status).toBe(200);
  });

  test('admin navigates sources, agents, docker targets, activity', async ({ page }) => {
    await loginPage(page, 'ADMIN');
    for (const route of ['/sources', '/agents', '/docker-targets', '/activity', '/sessions', '/credentials', '/settings']) {
      await page.goto(route);
      await expect(page).toHaveURL(new RegExp(route.replace('/', '\\/')));
    }
  });

  test('settings pages render for admin', async ({ page }) => {
    await loginPage(page, 'ADMIN');
    await page.goto('/settings/authentication');
    await expect(page).toHaveURL(/settings\/authentication/);
    void secrets;
  });
});
