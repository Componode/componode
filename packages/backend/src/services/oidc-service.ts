import { uuidv7 } from "uuidv7";
import * as client from "openid-client";
import { db } from "../db/connection.js";
import { EnvSecretResolver } from "../utils/secret-resolver.js";
import { decryptSecrets, loadKeyring } from "../utils/credential-crypto.js";
import { createSession } from "./session-service.js";
import { getSetting } from "./settings-service.js";
import { writeAuthEvent, writeEntityChange } from "./audit-service.js";
import type { Role } from "@componode/core";

interface OidcState {
  redirectUri: string;
  pkceVerifier: string;
  nonce: string;
}

// In-memory state store (v1 single-instance). Keyed by state token.
const stateStore = new Map<string, OidcState>();

// Cached openid-client Configuration per issuer/client tuple. The key includes
// the row's updatedAt so an OIDC settings change refreshes discovery.
let configCache: { key: string; config: client.Configuration } | null = null;

async function getOidcConfig() {
  const config = await db
    .selectFrom("oidc_config")
    .selectAll()
    .where("oidc_config.id", "=", 1)
    .executeTakeFirst();
  return config;
}

async function getClientConfig(config: {
  issuer: string;
  clientId: string;
  clientSecretRef: string | null;
  clientSecretCredentialId: string | null;
  updatedAt: string;
}): Promise<client.Configuration> {
  const key = `${config.issuer}|${config.clientId}|${config.clientSecretCredentialId ?? config.clientSecretRef ?? ""}|${config.updatedAt}`;
  if (configCache?.key === key) return configCache.config;

  const secret = await resolveClientSecret(config);
  const clientAuth = secret
    ? client.ClientSecretPost(secret)
    : client.None();

  // discovery() fetches {issuer}/.well-known/openid-configuration and verifies
  // that the document's `issuer` matches the configured issuer URL.
  const discovered = await client.discovery(new URL(config.issuer), config.clientId, undefined, clientAuth);

  // Enforce ID-token signature verification against the issuer JWKS even for
  // tokens received from the token endpoint over TLS (OIDC Core allows relying
  // on TLS alone there — we require the JWS signature regardless).
  client.enableNonRepudiationChecks(discovered);

  configCache = { key, config: discovered };
  return discovered;
}

export async function initiateLogin(redirectUri: string = "/", callbackBaseUrl: string): Promise<string> {
  const config = await getOidcConfig();
  if (!config || !config.enabled || !config.issuer || !config.clientId) {
    throw Object.assign(new Error("OIDC not configured"), {
      statusCode: 503,
      code: "OIDC_NOT_CONFIGURED",
    });
  }

  const clientConfig = await getClientConfig({
    issuer: config.issuer,
    clientId: config.clientId,
    clientSecretRef: config.clientSecretRef,
    clientSecretCredentialId: config.clientSecretCredentialId,
    updatedAt: config.updatedAt,
  });

  const state = client.randomState();
  const nonce = client.randomNonce();
  const pkceVerifier = client.randomPKCECodeVerifier();
  const challenge = await client.calculatePKCECodeChallenge(pkceVerifier);

  stateStore.set(state, { redirectUri, pkceVerifier, nonce });

  const callbackUri = `${callbackBaseUrl.replace(/\/$/, "")}/api/v1/auth/oidc/callback`;
  const authorizationUrl = client.buildAuthorizationUrl(clientConfig, {
    redirect_uri: callbackUri,
    scope: "openid profile email",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });

  return authorizationUrl.href;
}

export async function handleCallback(callbackUrl: URL): Promise<{ sessionToken: string; redirectUri: string }> {
  const config = await getOidcConfig();
  if (!config || !config.enabled || !config.issuer || !config.clientId) {
    throw Object.assign(new Error("OIDC not configured"), {
      statusCode: 503,
      code: "OIDC_NOT_CONFIGURED",
    });
  }

  const state = callbackUrl.searchParams.get("state") ?? "";
  const storedState = stateStore.get(state);
  if (!storedState) {
    throw Object.assign(new Error("Invalid state parameter"), {
      statusCode: 400,
      code: "OIDC_INVALID_STATE",
    });
  }
  stateStore.delete(state);

  const clientConfig = await getClientConfig({
    issuer: config.issuer,
    clientId: config.clientId,
    clientSecretRef: config.clientSecretRef,
    clientSecretCredentialId: config.clientSecretCredentialId,
    updatedAt: config.updatedAt,
  });

  // authorizationCodeGrant() validates state, exchanges the code at the
  // discovered token endpoint, and verifies the ID token signature (JWKS),
  // issuer, audience, expiry, issued-at, and nonce.
  let tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers;
  try {
    tokens = await client.authorizationCodeGrant(clientConfig, callbackUrl, {
      expectedState: state,
      expectedNonce: storedState.nonce,
      pkceCodeVerifier: storedState.pkceVerifier,
      idTokenExpected: true,
    });
  } catch (err) {
    if (err instanceof client.AuthorizationResponseError || err instanceof client.ResponseBodyError) {
      throw Object.assign(new Error("Code exchange failed"), {
        statusCode: 400,
        code: "OIDC_INVALID_CODE",
      });
    }
    throw Object.assign(new Error("ID token verification failed"), {
      statusCode: 401,
      code: "OIDC_TOKEN_VERIFICATION_FAILED",
    });
  }

  const claims = tokens.claims();
  const oidcSubject = claims?.sub;
  if (!oidcSubject) {
    throw Object.assign(new Error("ID token missing sub claim"), {
      statusCode: 401,
      code: "OIDC_TOKEN_VERIFICATION_FAILED",
    });
  }

  // Find or create user (JIT provisioning)
  let user = await db
    .selectFrom("persons")
    .selectAll()
    .where("persons.oidcSubject", "=", oidcSubject)
    .executeTakeFirst();

  if (!user) {
    const defaultRole = String(await getSetting("defaultUserRole") ?? "VIEWER") as Role;
    const usernameRaw = (claims.preferred_username ?? claims.email ?? `oidc-${oidcSubject.slice(0, 12)}`) as string;
    const username = usernameRaw.toLowerCase();
    const now = new Date().toISOString();

    const id = uuidv7();
    await db
      .transaction()
      .execute(async (trx) => {
        await trx
          .insertInto("persons")
          .values({
            id,
            username,
            oidcSubject,
            role: defaultRole,
            displayName: (claims.name as string | null | undefined) ?? null,
            email: (claims.email as string | null | undefined) ?? null,
            slug: username.replace(/[^a-z0-9_-]/g, "-"),
            isActive: true,
            createdAt: now,
            updatedAt: now,
          })
          .execute();

        await writeEntityChange(
          {
            entityType: "user",
            entityId: id,
            action: "created",
            changes: { role: defaultRole, oidcSubject, source: "oidc" },
            actor: { id: null, name: `oidc:${username}` },
          },
          trx,
        );
      });

    user = await db
      .selectFrom("persons")
      .selectAll()
      .where("persons.id", "=", id)
      .executeTakeFirst();
  }

  if (!user || !user.isActive) {
    throw Object.assign(new Error("User inactive"), {
      statusCode: 403,
      code: "AUTH_FORBIDDEN",
    });
  }

  const sessionToken = await createSession(user.id);

  await writeAuthEvent("oidc_signin", null, {
    id: user.id,
    name: user.displayName ?? user.username,
  });

  return { sessionToken, redirectUri: storedState.redirectUri };
}

let legacySecretWarned = false;

// Resolve the OIDC client secret (spec 013 US7): a stored credential wins
// over the deprecated env `clientSecretRef`, which still works during the
// deprecation window and logs a warning once per process.
export async function resolveClientSecret(config: {
  clientSecretCredentialId: string | null;
  clientSecretRef: string | null;
}): Promise<string | null> {
  if (config.clientSecretCredentialId) {
    const keyring = await loadKeyring();
    if (!keyring) {
      throw Object.assign(
        new Error("Credential store is unavailable: no master key configured"),
        { statusCode: 503, code: "CREDENTIAL_KEY_UNAVAILABLE" },
      );
    }
    const credential = await db
      .selectFrom("credentials")
      .select(["id", "label", "status", "encryptedPayload"])
      .where("id", "=", config.clientSecretCredentialId)
      .executeTakeFirst();
    if (!credential) {
      throw Object.assign(new Error("Credential not found"), {
        statusCode: 404,
        code: "CREDENTIAL_NOT_FOUND",
      });
    }
    if (credential.status === "REVOKED") {
      throw Object.assign(
        new Error(`Credential "${credential.label}" is revoked and cannot be used`),
        { statusCode: 409, code: "CREDENTIAL_REVOKED" },
      );
    }
    const payload = decryptSecrets(credential.encryptedPayload, keyring);
    const secret = payload.clientSecret ?? Object.values(payload)[0];
    if (!secret) {
      throw Object.assign(
        new Error(`Credential "${credential.label}" has no usable secret value`),
        { statusCode: 400, code: "CREDENTIAL_MISSING_KEY" },
      );
    }
    return secret;
  }

  if (config.clientSecretRef) {
    if (!legacySecretWarned) {
      legacySecretWarned = true;
      console.warn(
        "OIDC clientSecretRef (env) is deprecated — store the client secret " +
          "as a credential and set clientSecretCredentialId instead",
      );
    }
    const resolver = new EnvSecretResolver();
    return resolver.resolve({ key: "clientSecret", env: config.clientSecretRef });
  }

  return null;
}

/**
 * Check if OIDC is enabled (public status check for login page).
 */
export async function isOidcEnabled(): Promise<boolean> {
  const config = await getOidcConfig();
  return config?.enabled === true && !!config.issuer && !!config.clientId;
}
