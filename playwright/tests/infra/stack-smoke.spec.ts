import { test, expect } from '@playwright/test';
import { loginPage } from '../fixtures/auth.js';

test.describe('stack smoke journey', () => {
  test('admin logs in through the UI and reaches the app @smoke', async ({ page }) => {
    await loginPage(page, 'ADMIN');
    await page.goto('/');
    await expect(page).not.toHaveURL(/\/login/);
    const res = await page.request.get('/api/v1/auth/session');
    expect(res.ok()).toBeTruthy();
  });

  test('app health endpoint is reachable through trusted HTTPS', async ({ request }) => {
    const res = await request.get('https://app.componode-pw.test/api/v1/health');
    expect(res.ok()).toBeTruthy();
  });
});
