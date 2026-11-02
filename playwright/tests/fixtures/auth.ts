import { readFileSync, existsSync } from 'node:fs';
import { expect, type Page, type APIRequestContext } from '@playwright/test';

const BASE = 'https://app.componode-pw.test';

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

interface Session {
  session: string;
  csrf: string;
}

// One login per role per worker — the login endpoint is rate-limited, so
// sessions are established once and shared across specs in the process.
const sessions = new Map<Role, Promise<Session>>();

function parseCookies(setCookie: string | string[] | undefined): Map<string, string> {
  const jar = new Map<string, string>();
  if (!setCookie) return jar;
  const raw = Array.isArray(setCookie) ? setCookie.join(',') : setCookie;
  for (const part of raw.split(/,(?=[^ ])/)) {
    const pair = part.split(';')[0]!;
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1));
  }
  return jar;
}

async function establishSession(role: Role): Promise<Session> {
  const { username, password } = creds(role);
  const jar = new Map<string, string>();
  const grab = (setCookie: string | string[] | undefined) => {
    for (const [k, v] of parseCookies(setCookie)) jar.set(k, v);
  };
  const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');

  for (let attempt = 0; attempt < 6; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 5000 * attempt));
    const pre = await fetch(`${BASE}/api/v1/auth/session`, { redirect: 'manual' });
    grab(pre.headers.get('set-cookie') ?? undefined);
    const res = await fetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': jar.get('componode_csrf') ?? '',
        cookie: cookieHeader(),
      },
      body: JSON.stringify({ username, password }),
    });
    grab(res.headers.get('set-cookie') ?? undefined);
    if (res.status === 429) continue;
    if (res.status !== 200) throw new Error(`login ${role}: HTTP ${res.status}`);
    const session = jar.get('componode_session');
    const csrf = jar.get('componode_csrf');
    if (session && csrf) return { session, csrf };
  }
  throw new Error(`login ${role}: exhausted retries`);
}

function sessionFor(role: Role): Promise<Session> {
  if (!sessions.has(role)) sessions.set(role, establishSession(role));
  return sessions.get(role)!;
}

export type ApiCall = (
  method: string,
  path: string,
  body?: unknown,
) => Promise<{ status: number; body: any }>;

/**
 * API session wrapper — sends the session + CSRF cookies explicitly on every
 * call (cookie values are echoed in the x-csrf-token header per the app's
 * double-submit scheme). Retries once after re-login on 401.
 */
export async function apiLogin(
  _request: APIRequestContext,
  baseURL: string,
  role: Role,
): Promise<ApiCall> {
  const call = async (method: string, path: string, data?: unknown): Promise<{ status: number; body: any }> => {
    const s = await sessionFor(role);
    const r = await fetch(`${baseURL}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        cookie: `componode_session=${s.session}; componode_csrf=${s.csrf}`,
        'x-csrf-token': s.csrf,
      },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    if (r.status === 401 && sessions.has(role)) {
      // Session died — force a fresh login and retry once.
      sessions.delete(role);
      const fresh = await sessionFor(role);
      const retry = await fetch(`${baseURL}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          cookie: `componode_session=${fresh.session}; componode_csrf=${fresh.csrf}`,
          'x-csrf-token': fresh.csrf,
        },
        body: data === undefined ? undefined : JSON.stringify(data),
      });
      return { status: retry.status, body: await safeJson(retry) };
    }
    return { status: r.status, body: await safeJson(r) };
  };
  return call;
}

async function safeJson(res: Response): Promise<any> {
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

/**
 * Browser login — injects the shared API session as cookies rather than
 * driving the form (the login page itself is covered by dedicated specs).
 */
export async function loginPage(page: Page, role: Role): Promise<void> {
  const s = await sessionFor(role);
  const domain = new URL(BASE).hostname;
  await page.context().addCookies([
    { name: 'componode_session', value: s.session, domain, path: '/', secure: true, sameSite: 'Lax' },
    { name: 'componode_csrf', value: s.csrf, domain, path: '/', secure: true, sameSite: 'Lax' },
  ]);
  await page.goto('/');
  await expect(page).not.toHaveURL(/\/login/, { timeout: 15_000 });
}

/** Anonymous POST helper — primes a CSRF cookie for public endpoints. */
export async function anonPost(request: APIRequestContext, path: string, data?: unknown) {
  const pre = await fetch(`${BASE}/api/v1/auth/session`, { redirect: 'manual' });
  const jar = parseCookies(pre.headers.get('set-cookie') ?? undefined);
  const csrf = jar.get('componode_csrf') ?? '';
  return request.fetch(`${BASE}${path}`, {
    method: 'POST',
    data,
    headers: {
      cookie: `componode_csrf=${csrf}`,
      'x-csrf-token': csrf,
    },
  });
}
