import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api } from "../../api/client.js";

/**
 * Regression: Fastify rejects an empty body when Content-Type is
 * application/json, so body-less POST/DELETE calls (e.g. import run
 * trigger/cancel) must not declare a JSON content type.
 */
describe("api client request headers", () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as unknown as Response);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("omits Content-Type on a POST without a body", async () => {
    await api("/importer-configs/x/trigger", { method: "POST" });

    const init = vi.mocked(globalThis.fetch).mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("omits Content-Type on a DELETE without a body", async () => {
    await api("/importer-configs/x", { method: "DELETE" });

    const init = vi.mocked(globalThis.fetch).mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
  });

  it("sets application/json Content-Type when a body is sent", async () => {
    await api("/importer-configs", {
      method: "POST",
      body: JSON.stringify({ label: "x" }),
    });

    const init = vi.mocked(globalThis.fetch).mock.calls[0]?.[1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });
});
