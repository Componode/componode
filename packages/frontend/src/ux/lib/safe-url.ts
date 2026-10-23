/**
 * Validates that a URL is safe for rendering (ADR-085).
 * Only allows http: and https: protocols. Returns undefined for invalid URLs.
 */
export function safeUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      return url;
    }
    return undefined;
  } catch {
    return undefined;
  }
}
