import { vi } from "vitest";

export interface MockRoute {
  /** URL pathname (e.g. "/orgs/testorg/repos") — matched exactly */
  path: string;
  /** Optional query params that must match (e.g. { type: "container" }) */
  query?: Record<string, string>;
  status?: number;
  body: unknown;
}

export function mockFetch(routes: MockRoute[]) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    const url = new URL(String(input));
    // GHES baseUrls append the API prefix (e.g. /api/v3) to the pathname —
    // strip it so routes match regardless of the configured base URL.
    const pathname = url.pathname.replace(/^\/api\/v\d+/, "");
    const route = routes.find((r) => {
      if (r.path !== pathname) return false;
      if (!r.query) return true;
      return Object.entries(r.query).every(
        ([k, v]) => url.searchParams.get(k) === v,
      );
    });

    if (!route) {
      return new Response("Not Found", { status: 404 });
    }
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      headers: { "Content-Type": "application/json" },
    });
  });
}
