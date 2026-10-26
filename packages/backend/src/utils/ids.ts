const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Detail reads accept the id OR the slug — the identifier UX detail
 * routes carry. UUID-shaped values try `byId` first and fall back to
 * `bySlug` (a derived slug can itself be UUID-shaped).
 */
export async function resolveIdOrSlug<T>(
  idOrSlug: string,
  byId: () => Promise<T | undefined>,
  bySlug: () => Promise<T | undefined>,
): Promise<T | undefined> {
  if (isUuid(idOrSlug)) {
    const byIdResult = await byId();
    if (byIdResult) return byIdResult;
  }
  return bySlug();
}
