import { describe, it, expect, vi } from "vitest";
import { executeHttpProbe } from "../../src/monitoring/probe.js";

// Spec 051 / ADR-123 §6: request-start → response-headers timing, no
// redirects, no body parsing, ADR-106 URL validation at run time.

const fakeResponse = (status: number) =>
  ({
    status,
    body: { cancel: vi.fn(async () => undefined) },
  }) as unknown as Response;

describe("executeHttpProbe", () => {
  it("returns status and header-boundary duration for a successful response", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(200));
    const result = await executeHttpProbe(
      { url: "https://example.com/health", method: "GET", timeoutMs: 5000 },
      fetchImpl,
    );
    expect(result.responseReceived).toBe(true);
    expect(result.httpStatus).toBe(200);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.errorType).toBeNull();
  });

  it("does not follow redirects — 3xx returned as-received", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(301));
    const result = await executeHttpProbe(
      { url: "https://example.com/moved", method: "GET", timeoutMs: 5000 },
      fetchImpl,
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.com/moved",
      expect.objectContaining({ redirect: "manual" }),
    );
    expect(result.httpStatus).toBe(301);
    expect(result.errorType).toBeNull();
  });

  it("cancels the response body after headers arrive", async () => {
    const res = fakeResponse(200);
    const fetchImpl = vi.fn(async () => res);
    await executeHttpProbe(
      { url: "https://example.com/big", method: "GET", timeoutMs: 5000 },
      fetchImpl,
    );
    expect(res.body!.cancel).toHaveBeenCalled();
  });

  it("rejects URLs that fail ADR-106 destination validation", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(200));
    const result = await executeHttpProbe(
      { url: "http://127.0.0.1:8080/", method: "GET", timeoutMs: 5000 },
      fetchImpl,
    );
    expect(result.responseReceived).toBe(false);
    expect(result.errorType).toBe("POLICY_BLOCKED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps timeout errors to TIMEOUT", async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error("timed out"), { name: "TimeoutError" });
    });
    const result = await executeHttpProbe(
      { url: "https://example.com/slow", method: "GET", timeoutMs: 50 },
      fetchImpl,
    );
    expect(result.responseReceived).toBe(false);
    expect(result.errorType).toBe("TIMEOUT");
  });

  it("maps DNS failures to DNS", async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new TypeError("fetch failed"), {
        cause: { code: "ENOTFOUND" },
      });
    });
    const result = await executeHttpProbe(
      { url: "https://nope.invalid/", method: "GET", timeoutMs: 5000 },
      fetchImpl,
    );
    expect(result.errorType).toBe("DNS");
  });

  it("maps connection failures to CONNECT", async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new TypeError("fetch failed"), {
        cause: { code: "ECONNREFUSED" },
      });
    });
    const result = await executeHttpProbe(
      { url: "https://example.com/", method: "GET", timeoutMs: 5000 },
      fetchImpl,
    );
    expect(result.errorType).toBe("CONNECT");
  });

  it("maps certificate failures to TLS", async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new TypeError("fetch failed"), {
        cause: { code: "SELF_SIGNED_CERT_IN_CHAIN" },
      });
    });
    const result = await executeHttpProbe(
      { url: "https://example.com/", method: "GET", timeoutMs: 5000 },
      fetchImpl,
    );
    expect(result.errorType).toBe("TLS");
  });

  it("maps caller aborts to ABORTED", async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    });
    const result = await executeHttpProbe(
      { url: "https://example.com/", method: "GET", timeoutMs: 5000 },
      fetchImpl,
    );
    expect(result.errorType).toBe("ABORTED");
  });

  it("maps unknown failures to OTHER", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("weird");
    });
    const result = await executeHttpProbe(
      { url: "https://example.com/", method: "GET", timeoutMs: 5000 },
      fetchImpl,
    );
    expect(result.errorType).toBe("OTHER");
  });

  it("sends HEAD requests when configured", async () => {
    const fetchImpl = vi.fn(async () => fakeResponse(200));
    await executeHttpProbe(
      { url: "https://example.com/", method: "HEAD", timeoutMs: 5000 },
      fetchImpl,
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://example.com/",
      expect.objectContaining({ method: "HEAD" }),
    );
  });
});
