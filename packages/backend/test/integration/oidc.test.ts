import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { generateKeyPair, exportJWK, SignJWT, type KeyLike, type JWK } from "jose";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import {
  csrfCookie,
  csrfHeader,
  loginAs,
  SESSION_COOKIE_NAME,
} from "../helpers/api.js";

const ADMIN_USERNAME = "admin";
const ADMIN_PASSWORD = "AdminPassword123!";
const ISSUER = "https://idp.example.com";
const CLIENT_ID = "componode-client";
const KID = "test-key-1";

let privateKey: KeyLike;
let publicJwk: JWK;
let attackerPrivateKey: KeyLike;
let lastNonce: string | null = null;

function makeUnsignedIdToken(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${header}.${payload}.`;
}

async function signIdToken(
  claims: Record<string, unknown>,
  opts: { iss?: string; aud?: string; nonce?: string | null; exp?: number; key?: KeyLike } = {},
): Promise<string> {
  const payload = { ...claims, nonce: opts.nonce === undefined ? lastNonce : opts.nonce };
  let jwt = new SignJWT(payload)
    .setProtectedHeader({ alg: "RS256", kid: KID })
    .setIssuer(opts.iss ?? ISSUER)
    .setAudience(opts.aud ?? CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime(opts.exp ?? Math.floor(Date.now() / 1000) + 300);
  return jwt.sign(opts.key ?? privateKey);
}

function discoveryResponse() {
  return new Response(
    JSON.stringify({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint: `${ISSUER}/oauth/token`,
      jwks_uri: `${ISSUER}/jwks`,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function jwksResponse() {
  return new Response(JSON.stringify({ keys: [publicJwk] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function tokenResponse(idToken: string) {
  return new Response(
    JSON.stringify({
      id_token: idToken,
      access_token: "mock-access-token",
      token_type: "Bearer",
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

const BASE_CLAIMS = {
  sub: "existing-oidc-sub",
  preferred_username: "oidcuser",
  email: "oidc@example.com",
  name: "OIDC User",
};

describe("OIDC", () => {
  let testDb: TestDb | null = null;
  let app: any;
  let adminSession: string | undefined;
  let originalDbUrl: string | undefined;
  let originalNodeEnv: string | undefined;
  let originalBootstrapUsername: string | undefined;
  let originalBootstrapPassword: string | undefined;
  let originalClientSecret: string | undefined;
  let originalPublicUrl: string | undefined;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    originalDbUrl = process.env.DATABASE_URL;
    originalNodeEnv = process.env.NODE_ENV;
    originalBootstrapUsername = process.env.BOOTSTRAP_ADMIN_USERNAME;
    originalBootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
    originalClientSecret = process.env.MOCK_CLIENT_SECRET;
    originalPublicUrl = process.env.PUBLIC_URL;

    const pair = await generateKeyPair("RS256", { extractable: true });
    privateKey = pair.privateKey;
    publicJwk = await exportJWK(pair.publicKey);
    publicJwk.kid = KID;
    publicJwk.alg = "RS256";
    publicJwk.use = "sig";
    attackerPrivateKey = (await generateKeyPair("RS256")).privateKey;
    lastNonce = null;

    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    process.env.NODE_ENV = "test";
    process.env.BOOTSTRAP_ADMIN_USERNAME = ADMIN_USERNAME;
    process.env.BOOTSTRAP_ADMIN_PASSWORD = ADMIN_PASSWORD;
    process.env.MOCK_CLIENT_SECRET = "mock-client-secret";
    process.env.PUBLIC_URL = "https://app.example.com";
    vi.resetModules();

    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input instanceof Request ? input.url : input));
      if (url.pathname === "/.well-known/openid-configuration") {
        return discoveryResponse();
      }
      if (url.pathname === "/jwks") {
        return jwksResponse();
      }
      if (url.pathname === "/oauth/token") {
        const bodyText = init?.body ? String(init.body) : "";
        const body = new URLSearchParams(bodyText);
        const code = body.get("code");
        switch (code) {
          case "invalid-code":
            return new Response(JSON.stringify({ error: "invalid_grant" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
          case "mock-code-new-user":
            return tokenResponse(await signIdToken({
              sub: "new-oidc-sub",
              preferred_username: "newoidcuser",
              email: "new@example.com",
              name: "New OIDC User",
            }));
          case "code-alg-none":
            return tokenResponse(makeUnsignedIdToken({ ...BASE_CLAIMS, nonce: lastNonce }));
          case "code-wrong-iss":
            return tokenResponse(await signIdToken(BASE_CLAIMS, { iss: "https://evil.example.com" }));
          case "code-wrong-aud":
            return tokenResponse(await signIdToken(BASE_CLAIMS, { aud: "attacker-client" }));
          case "code-expired":
            return tokenResponse(await signIdToken(BASE_CLAIMS, { exp: Math.floor(Date.now() / 1000) - 3600 }));
          case "code-bad-sig":
            return tokenResponse(await signIdToken(BASE_CLAIMS, { key: attackerPrivateKey }));
          case "code-wrong-nonce":
            return tokenResponse(await signIdToken(BASE_CLAIMS, { nonce: "attacker-nonce" }));
          case "mock-code":
            return tokenResponse(await signIdToken(BASE_CLAIMS));
          default:
            return new Response(JSON.stringify({ error: "invalid_grant" }), {
              status: 401,
              headers: { "Content-Type": "application/json" },
            });
        }
      }
      return new Response("Not Found", { status: 404 });
    });

    const { bootstrapAdmin } = await import("../../src/services/bootstrap-service.js");
    await bootstrapAdmin();

    const { buildApp } = await import("../../src/app.js");
    app = await buildApp();
    await app.ready();

    adminSession = await loginAs(app, ADMIN_USERNAME, ADMIN_PASSWORD);
  });

  afterEach(async () => {
    fetchSpy?.mockRestore();
    if (app) await app.close();
    if (testDb) await testDb.cleanup();
    if (originalDbUrl !== undefined) process.env.DATABASE_URL = originalDbUrl;
    else delete process.env.DATABASE_URL;
    if (originalNodeEnv !== undefined) process.env.NODE_ENV = originalNodeEnv;
    else delete process.env.NODE_ENV;
    if (originalBootstrapUsername !== undefined) process.env.BOOTSTRAP_ADMIN_USERNAME = originalBootstrapUsername;
    else delete process.env.BOOTSTRAP_ADMIN_USERNAME;
    if (originalBootstrapPassword !== undefined) process.env.BOOTSTRAP_ADMIN_PASSWORD = originalBootstrapPassword;
    else delete process.env.BOOTSTRAP_ADMIN_PASSWORD;
    if (originalClientSecret !== undefined) process.env.MOCK_CLIENT_SECRET = originalClientSecret;
    else delete process.env.MOCK_CLIENT_SECRET;
    if (originalPublicUrl !== undefined) process.env.PUBLIC_URL = originalPublicUrl;
    else delete process.env.PUBLIC_URL;
    vi.resetModules();
  });

  async function configureOidc(overrides: Record<string, unknown> = {}): Promise<unknown> {
    const res = await app.inject({
      method: "PUT",
      url: "/api/v1/settings/oidc",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload: {
        enabled: true,
        issuer: ISSUER,
        clientId: CLIENT_ID,
        clientSecretRef: "MOCK_CLIENT_SECRET",
        roleClaimPath: "groups",
        claimValueField: "name",
        roleMapping: { "componode-admins": "ADMIN" },
        ...overrides,
      },
    });
    expect(res.statusCode).toBe(200);
    return res.json();
  }

  async function initiateLogin(): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/oidc/login",
      cookies: csrfCookie,
      headers: csrfHeader,
    });
    expect(res.statusCode).toBe(302);
    const location = res.headers["location"];
    expect(typeof location).toBe("string");
    const url = new URL(location as string);
    lastNonce = url.searchParams.get("nonce");
    expect(lastNonce).toBeTruthy();
    return url.searchParams.get("state") ?? "";
  }

  async function runCallback(code: string, state: string) {
    return app.inject({
      method: "GET",
      url: `/api/v1/auth/oidc/callback?code=${code}&state=${state}`,
    });
  }

  it("admin configures OIDC via PUT /api/v1/settings/oidc → 200", async () => {
    const body = await configureOidc();
    expect(body.oidcConfig.enabled).toBe(true);
    expect(body.oidcConfig.issuer).toBe(ISSUER);
  });

  it("initiates OIDC login via POST /auth/oidc/login → 302 redirect", async () => {
    await configureOidc();
    const state = await initiateLogin();
    expect(state).toBeTruthy();
  });

  it("callback with a valid signed code+state returns 302 and sets a session cookie", async () => {
    await configureOidc();
    const state = await initiateLogin();

    const res = await runCallback("mock-code", state);

    expect(res.statusCode).toBe(302);
    const setCookie = res.headers["set-cookie"];
    const headerStr = Array.isArray(setCookie) ? setCookie.join("\n") : String(setCookie ?? "");
    expect(headerStr).toContain(SESSION_COOKIE_NAME);
  });

  it("JIT-provisions a new oidcSubject as a Viewer user", async () => {
    await configureOidc();
    const state = await initiateLogin();

    const res = await runCallback("mock-code-new-user", state);
    expect(res.statusCode).toBe(302);

    const persons = await testDb!.db
      .selectFrom("persons")
      .select(["persons.id", "persons.oidcSubject", "persons.role"])
      .where("persons.oidcSubject", "is not", null)
      .execute();
    const jitUser = persons.find((p) => p.oidcSubject === "new-oidc-sub");
    expect(jitUser).toBeDefined();
    expect(jitUser!.role).toBe("VIEWER");
  });

  it("callback with invalid state → 400", async () => {
    await configureOidc();
    const res = await app.inject({
      method: "GET",
      url: "/api/v1/auth/oidc/callback?code=mock-code&state=bad-state",
    });
    expect(res.statusCode).toBe(400);
  });

  it("OIDC login when disabled → 503", async () => {
    await configureOidc();
    await app.inject({
      method: "PUT",
      url: "/api/v1/settings/oidc",
      cookies: { [SESSION_COOKIE_NAME]: adminSession!, ...csrfCookie },
      headers: csrfHeader,
      payload: { enabled: false },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/v1/auth/oidc/login",
      cookies: csrfCookie,
      headers: csrfHeader,
    });
    expect(res.statusCode).toBe(503);
  });

  it("callback with an invalid code → 400", async () => {
    await configureOidc();
    const state = await initiateLogin();

    const res = await runCallback("invalid-code", state);
    expect(res.statusCode).toBe(400);
  });

  it.each([
    ["alg:none token", "code-alg-none"],
    ["wrong issuer", "code-wrong-iss"],
    ["wrong audience", "code-wrong-aud"],
    ["expired token", "code-expired"],
    ["signature from unknown key", "code-bad-sig"],
    ["mismatched nonce", "code-wrong-nonce"],
  ])("rejects a forged ID token (%s) → 401 OIDC_TOKEN_VERIFICATION_FAILED", async (_label, code) => {
    await configureOidc();
    const state = await initiateLogin();

    const res = await runCallback(code as string, state);
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("OIDC_TOKEN_VERIFICATION_FAILED");
  });
});
