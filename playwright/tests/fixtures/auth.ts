import { readFileSync, existsSync } from 'node:fs';
import { expect, type Page, type APIRequestContext } from '@playwright/test';

let secretsCache: Record<string, string> | null = null;

/** Per-run credentials — read only from the private mount, never printed. */
export function secrets(): Record<string, string> {
  if (!secretsCache) {
    const path = '/pw-private/env';
    if (!existsSync(path)) throw new Error('per-run secrets not mounted at /pw-private/env');
    secretsCache = Object.fromEntries(
      readFileSync(path, 'utf8')
        .split('\n').filter((l) => l.includes('='))
        .map((l) => l.split('=', 2) as [string, string]),
    );
  }
  return secretsCache!;
}

export type Role = 'ADMIN' | 'EDITOR' | 'VIEWER';

export function creds(role: Role): { username: string; password: string } {
  const s = secrets();
  const key = `PWP_${role}`;
  return { username: s[`${key}_USERNAME`]!, password: s[`${key}_PASSWORD`]! };
}

/** Browser login through the real form (rate-limited — reuse per spec file). */
export async function loginPage(page: Page, role: Role): Promise<void> {
  const { username, password } = creds(role);
  await page.goto('/login');
  await page.getByLabel(/username/i).fill(username);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole('button', { name: /sign in|log in/i }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
}

/**
 * API login — returns a wrapper that performs sessioned calls with the
 * session cookie and double-submit CSRF header attached.
 */
export async function apiLogin(
  request: APIRequestContext,
  baseURL: string,
  role: Role,
): Promise<(method: string, path: string, body?: unknown) => Promise<{ status: number; body: any }>> {
  const { username, password } = creds(role);
  const res = await request.post(`${baseURL}/api/v1/auth/login`, { data: { username, password } });
  if (res.status() !== 200) throw new Error(`api login ${role}: ${res.status()}`);
  const body = await res.json();
  const csrf = body.csrfToken as string;
  return async (method, path, data) => {
    const r = await request.fetch(`${baseURL}${path}`, {
      method,
      data: data === undefined ? undefined : data,
      headers: { 'x-csrf-token': csrf },
    });
    let parsed: any;
    try { parsed = await r.json(); } catch { parsed = await r.text(); }
    return { status: r.status(), body: parsed };
  };
}
