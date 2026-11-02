import { test, expect } from '@playwright/test';
import { secrets, apiLogin } from '../fixtures/auth.js';

const BASE = 'https://app.componode-pw.test';

test.describe('OIDC journeys (local Dex)', () => {
  test('full interactive login through Dex provisions a session', async ({ page }) => {
    const s = secrets();
    await page.goto('/login');
    const oidcButton = page.getByRole('button', { name: /sso|oidc|single sign/i });
    await oidcButton.click();
    // Dex login form.
    await expect(page).toHaveURL(/dex\.componode-pw\.test/, { timeout: 15_000 });
    await page.getByLabel(/email|username/i).fill(s.PWP_DEX_USER_EMAIL!);
    await page.getByLabel(/password/i).fill(s.PWP_DEX_USER_PASSWORD!);
    await page.getByRole('button', { name: /log ?in|grant|continue/i }).click();
    await expect(page).toHaveURL(/app\.componode-pw\.test/, { timeout: 20_000 });
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('OIDC callback failure surfaces a safe error, not a crash', async ({ page }) => {
    // Direct callback with a bogus state/code — must not 500.
    const res = await page.goto('/api/v1/auth/oidc/callback?code=bogus&state=bogus');
    expect([400, 401, 302, 303, 200]).toContain(res?.status() ?? 0);
  });

  test('admin can read OIDC status', async ({ request }) => {
    const admin = await apiLogin(request, BASE, 'ADMIN');
    const status = await admin('GET', '/api/v1/auth/oidc/status');
    expect(status.status).toBe(200);
  });
});
