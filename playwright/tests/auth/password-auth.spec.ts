import { test, expect, type APIRequestContext } from '@playwright/test';
import { loginPage, apiLogin, creds } from '../fixtures/auth.js';

const BASE = 'https://app.componode-pw.test';
const uid = () => `pw-reg-${Date.now().toString(36)}`;

/** Anonymous call wrapper — primes the CSRF cookie first, then posts. */
async function anon(request: APIRequestContext) {
  const pre = await request.get(`${BASE}/api/v1/auth/session`);
  const cookies = (pre.headers()['set-cookie'] ?? '') as string;
  const m = (Array.isArray(cookies) ? cookies.join(';') : cookies).match(/componode_csrf=([^;]+)/);
  const csrf = m?.[1] ?? '';
  return (path: string, data?: unknown) =>
    request.fetch(`${BASE}${path}`, {
      method: 'POST',
      data,
      headers: csrf ? { 'x-csrf-token': csrf } : {},
    });
}

test.describe('password authentication journeys', () => {
  test('wrong password is rejected with a safe error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/username/i).fill('pw-admin');
    await page.locator('input[type="password"]').first().fill('definitely-wrong-1');
    await page.getByRole('button', { name: /sign in|log in/i }).first().click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('logout invalidates the session', async ({ page }) => {
    await loginPage(page, 'EDITOR');
    const logoutButton = page.getByRole('button', { name: /log ?out|sign ?out/i });
    if (await logoutButton.count()) {
      await logoutButton.first().click();
      await expect(page).toHaveURL(/\/login/, { timeout: 10_000 });
    } else {
      const csrf = (await page.context().cookies()).find((c) => c.name === 'componode_csrf')?.value;
      const res = await page.request.post('/api/v1/auth/logout', {
        headers: csrf ? { 'x-csrf-token': csrf } : {},
      });
      expect(res.status()).toBeLessThan(400);
      await page.goto('/');
      await expect(page).toHaveURL(/\/login/);
    }
  });

  test('registration is denied when disabled, allowed when enabled', async ({ request }) => {
    const admin = await apiLogin(request, BASE, 'ADMIN');
    await admin('PATCH', '/api/v1/settings', { allowSelfRegistration: false });
    const post = await anon(request);
    const denied = await post('/api/v1/auth/register', {
      username: uid(), password: 'Pw!testuser-1234', displayName: 'PW',
    });
    expect([400, 403, 404]).toContain(denied.status());

    await admin('PATCH', '/api/v1/settings', { allowSelfRegistration: true });
    const name = uid();
    const allowed = await post('/api/v1/auth/register', {
      username: name, password: 'Pw!testuser-1234', displayName: 'PW Reg',
    });
    expect([200, 201]).toContain(allowed.status());
    await admin('PATCH', '/api/v1/settings', { allowSelfRegistration: false });
  });

  test('admin-generated password reset lets a user set a new password', async ({ request }) => {
    const admin = await apiLogin(request, BASE, 'ADMIN');
    const users = await admin('GET', '/api/v1/users');
    const list = users.body.users ?? users.body.items ?? users.body;
    const viewer = list.find((u: any) => u.username === creds('VIEWER').username);
    const reset = await admin('POST', '/api/v1/auth/password/reset', { userId: viewer.id });
    expect(reset.status).toBe(200);
    const token = reset.body.token;
    expect(token).toBeTruthy();
    const post = await anon(request);
    const confirm = await post('/api/v1/auth/password/reset/confirm', {
      token, newPassword: creds('VIEWER').password,
    });
    expect([200, 204]).toContain(confirm.status());
  });
});
