import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api, fieldErrors, type ApiError } from "../../api/client.js";

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

describe("fieldErrors — VALIDATION_FAILED detail extraction (bugfix 035)", () => {
  it("maps invalid-params name→reason from the bug-report payload", () => {
    const err: ApiError = {
      code: "VALIDATION_FAILED",
      message: "Invalid input",
      details: [
        {
          origin: "string",
          code: "too_small",
          minimum: 12,
          inclusive: true,
          path: ["password"],
          message: "Password must be at least 12 characters",
        },
      ],
      "invalid-params": [
        { name: "password", reason: "Password must be at least 12 characters" },
      ],
    };
    expect(fieldErrors(err)).toEqual({
      password: "Password must be at least 12 characters",
    });
  });

  it("falls back to the details array when invalid-params is absent", () => {
    const err: ApiError = {
      code: "VALIDATION_FAILED",
      message: "Invalid input",
      details: [{ path: ["username"], message: "Username is required" }],
    };
    expect(fieldErrors(err)).toEqual({ username: "Username is required" });
  });

  it("falls back to a details object map", () => {
    const err: ApiError = {
      code: "VALIDATION_FAILED",
      message: "Invalid input",
      details: { username: "Username is required" },
    };
    expect(fieldErrors(err)).toEqual({ username: "Username is required" });
  });

  it("returns {} for non-validation errors and missing payload detail", () => {
    expect(
      fieldErrors({ code: "AUTH_FORBIDDEN", message: "Forbidden" }),
    ).toEqual({});
    expect(
      fieldErrors({ code: "VALIDATION_FAILED", message: "Invalid input" }),
    ).toEqual({});
  });
});

describe("fieldErrors — unrecognized_keys mapping (F006)", () => {
  it("binds rejected keys from the keys array when path is empty", () => {
    const err: ApiError = {
      code: "VALIDATION_FAILED",
      message: "Invalid input",
      details: [
        { code: "unrecognized_keys", keys: ["lifecycle"], path: [], message: 'Unrecognized key: "lifecycle"' },
      ],
    };
    expect(fieldErrors(err)).toEqual({ lifecycle: 'Unrecognized key: "lifecycle"' });
  });
});
