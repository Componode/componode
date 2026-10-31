const AUTH_QUERY_PARAMS = new Set([
  "access_key",
  "access_token",
  "api_key",
  "apikey",
  "auth",
  "authorization",
  "client_secret",
  "code",
  "credential",
  "id_token",
  "jwt",
  "key",
  "oauth_token",
  "password",
  "private_key",
  "refresh_token",
  "secret",
  "session_token",
  "sig",
  "signature",
  "token",
  "x-amz-credential",
  "x-amz-security-token",
  "x-amz-signature",
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
      if (AUTH_QUERY_PARAMS.has(key.toLowerCase())) {
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
