const AUTH_QUERY_PARAMS = new Set([
  "access_token",
  "api_key",
  "apikey",
  "auth",
  "authorization",
  "client_secret",
  "credential",
  "key",
  "password",
  "sig",
  "signature",
  "token",
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
