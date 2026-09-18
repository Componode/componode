import { sql } from "kysely";
import { uuidv7 } from "uuidv7";

/**
 * Shared helpers for Fastify app.inject()-based integration tests.
 *
 * The CSRF plugin uses the double-submit cookie pattern: it only checks that
 * the `componode_csrf` cookie value matches the `x-csrf-token` header. In
 * tests we can supply any matching pair to satisfy the check.
 */
export const CSRF_COOKIE_NAME = "componode_csrf";
export const SESSION_COOKIE_NAME = "componode_session";

export const CSRF_TOKEN = "test-csrf-token-1234567890";

export const csrfCookie = { [CSRF_COOKIE_NAME]: CSRF_TOKEN };
export const csrfHeader = { "x-csrf-token": CSRF_TOKEN };

/** Extract a cookie value from a light-my-request inject response. */
export function getCookie(res: { cookies?: Array<{ name: string; value: string }>; headers?: Record<string, string | string[]> }, name: string): string | undefined {
  if (Array.isArray(res.cookies)) {
    const found = res.cookies.find((c) => c.name === name);
    if (found) return found.value;
  }
  const setCookie = res.headers?.["set-cookie"];
  if (setCookie) {
    const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    const match = new RegExp(`${name}=([^;]+)`).exec(String(header));
    if (match) return match[1];
  }
  return undefined;
}

/** Login via the API and return the session cookie value (or undefined). */
export async function loginAs(
  app: { inject: (opts: unknown) => Promise<{ cookies?: Array<{ name: string; value: string }>; headers?: Record<string, string | string[]>; statusCode: number }> },
  username: string,
  password: string,
): Promise<string | undefined> {
  const res = await app.inject({
    method: "POST",
    url: "/api/v1/auth/login",
    cookies: csrfCookie,
    headers: csrfHeader,
    payload: { username, password },
  });
  return getCookie(res, SESSION_COOKIE_NAME);
}

/**
 * Insert a person + active session directly into the DB and return the session
 * token. Useful for test setup that bypasses the login flow.
 */
export async function createSessionInDb(
  db: import("kysely").Kysely<unknown>,
  userId: string,
): Promise<{ token: string; publicId: string }> {
  const { randomBytes, createHash } = await import("crypto");
  const token = randomBytes(32).toString("base64url");
  const publicId = uuidv7();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 12 * 60 * 60 * 1000);
  await db
    .insertInto("sessions")
    .values({
      id: createHash("sha256").update(token).digest("hex"),
      publicId,
      tokenLast4: token.slice(-4),
      userId,
      createdAt: now.toISOString(),
      lastSeenAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    })
    .execute();
  return { token, publicId };
}

/** Insert a person directly into the DB and return its id. */
export async function createPersonInDb(
  db: import("kysely").Kysely<unknown>,
  overrides: {
    id?: string;
    username: string;
    passwordHash?: string | null;
    role?: string;
    displayName?: string | null;
    oidcSubject?: string | null;
    isActive?: boolean;
  },
): Promise<string> {
  const id = overrides.id ?? uuidv7();
  const now = new Date().toISOString();
  await db
    .insertInto("persons")
    .values({
      id,
      username: overrides.username,
      passwordHash: overrides.passwordHash ?? null,
      oidcSubject: overrides.oidcSubject ?? null,
      role: overrides.role ?? "VIEWER",
      displayName: overrides.displayName ?? null,
      slug: overrides.username.toLowerCase(),
      isActive: overrides.isActive ?? true,
      createdAt: now,
      updatedAt: now,
    })
    .execute();
  return id;
}

/**
 * Truncate import and component-related tables plus audit tables in test
 * teardown. `TRUNCATE ... CASCADE` bypasses the append-only row triggers on
 * `entity_changes`, `edge_changes`, and `import_run_errors` while correctly
 * handling the `importRunId` self-reference from `entity_changes` to
 * `import_runs`.
 */
export async function truncateImportTables(db: import("kysely").Kysely<unknown>): Promise<void> {
  await sql`
    TRUNCATE TABLE
      entity_changes,
      edge_changes,
      import_run_errors,
      import_runs,
      component_instances,
      components,
      component_groups,
      importer_config_credentials,
      credentials,
      importer_configs
    RESTART IDENTITY CASCADE
  `.execute(db);
}
