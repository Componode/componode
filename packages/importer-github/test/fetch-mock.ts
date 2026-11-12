import { vi } from "vitest";

export interface MockRoute {
  /** URL pathname (e.g. "/orgs/testorg/repos") — matched exactly */
  path: string;
  /** Optional query params that must match (e.g. { type: "container" }) */
  query?: Record<string, string>;
  status?: number;
  body: unknown;
  /** Extra response headers (e.g. Link for pagination) */
  headers?: Record<string, string>;
}

/**
 * Build a GitHub-style `Link: <next>; rel="next"` header value for a
 * paginated mock route. `pageUrl` is the absolute URL octokit will request
 * for the next page — it must carry the same pathname plus `?page=N`.
 */
export function nextPageLink(pageUrl: string): string {
  return `<${pageUrl}>; rel="next"`;
}

export function mockFetch(routes: MockRoute[]) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    // GHES baseUrls append the API prefix (e.g. /api/v3) to the pathname —
    // strip it so routes match regardless of the configured base URL.
    const pathname = url.pathname.replace(/^\/api\/v\d+/, "");
    // Prefer the most specific route (most query constraints) so paginated
    // fixtures can register `?page=N` variants ahead of the catch-all page.
    const matches = routes.filter((r) => {
      if (r.path !== pathname) return false;
      if (!r.query) return true;
      return Object.entries(r.query).every(
        ([k, v]) => url.searchParams.get(k) === v,
      );
    });
    matches.sort(
      (a, b) => Object.keys(b.query ?? {}).length - Object.keys(a.query ?? {}).length,
    );
    const route = matches[0];

    if (!route) {
      return new Response("Not Found", { status: 404 });
    }
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { "Content-Type": "application/json", ...route.headers },
    });
  });
}
