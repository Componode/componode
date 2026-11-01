// Normalized names — query-param keys are lowercased and stripped of
// non-alphanumerics before comparison so `accessToken`, `access-key`,
// and `access_token` all match `accesstoken`.
const AUTH_QUERY_PARAMS = new Set([
  "accesskey",
  "accesstoken",
  "apikey",
  "auth",
  "authorization",
  "authtoken",
  "clientsecret",
  "code",
  "credential",
  "idtoken",
  "jwt",
  "key",
  "oauthtoken",
  "password",
  "privatekey",
  "refreshtoken",
  "secret",
  "sessiontoken",
  "sig",
  "signature",
  "token",
  "xamzcredential",
  "xamzsecuritytoken",
  "xamzsignature",
]);

/**
 * Canonicalizes a provider-native source identity before persistence
 * (ADR-119 #1). URL identities lose userinfo, authentication query
 * parameters, and fragments so no secret material lands in the durable
 * identity. Non-URL identities are returned trimmed, unchanged.
 */
export function canonicalizeSourceIdentity(identity: string): string {
  const trimmed = identity.trim();
  try {
    const url = new URL(trimmed);
    url.username = "";
    url.password = "";
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (AUTH_QUERY_PARAMS.has(normalized)) {
        url.searchParams.delete(key);
      }
    }
    return url.toString();
  } catch {
    return trimmed;
  }
}

const QUALIFIER_SEPARATOR = "::";

/**
 * Qualifies a provider-native externalId with the reporting Source's
 * canonical identity: `{identity}::{nativeId}` (ADR-120). Applied only
 * where the native ID is not globally unique — globally-unique provider
 * IDs (ARNs, self-describing URLs) stay unqualified.
 */
export function qualifyExternalId(identity: string, nativeId: string): string {
  return `${identity}${QUALIFIER_SEPARATOR}${nativeId}`;
}

/** True when `externalId` carries this Source's `{identity}::` prefix. */
export function isQualifiedExternalId(
  externalId: string,
  identity: string,
): boolean {
  return externalId.startsWith(`${identity}${QUALIFIER_SEPARATOR}`);
}

/**
 * Strips this Source's qualifier, returning the pre-migration legacy
 * form — or null when the id is not qualified for this identity. Exact
 * prefix matching avoids `::` ambiguity inside the identity itself.
 */
export function unqualifyExternalId(
  externalId: string,
  identity: string,
): string | null {
  const prefix = `${identity}${QUALIFIER_SEPARATOR}`;
  return externalId.startsWith(prefix) ? externalId.slice(prefix.length) : null;
}
