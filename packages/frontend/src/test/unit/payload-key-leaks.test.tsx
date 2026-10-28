import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import * as React from "react";
import { useConfirmReset } from "@/api/hooks/password";

const hooksDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../api/hooks");

/**
 * F011 regression guard — a mutation must never stringify the whole `vars`
 * object into the PATCH/POST body while also interpolating `vars.*` into the
 * URL: `id` (or any routing field) leaks into a strict update schema and
 * 400s with unrecognized_keys. Destructure first (users.ts/org.ts pattern).
 */
describe("mutation payloads — no routing fields in the body (F011)", () => {
  it("no hook stringifies vars into the body while using vars.* in the URL", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(hooksDir).filter((f) => f.endsWith(".ts"))) {
      const src = readFileSync(join(hooksDir, file), "utf-8");
      // Each api( call: URL uses vars.<field> AND body is the whole vars.
      const calls = src.match(/api<[^`]*?`\$\{vars\.[^}]*\}`[\s\S]*?body:\s*JSON\.stringify\(vars\)/g);
      if (calls) offenders.push(...calls.map((call) => `${file}: ${call.slice(0, 80)}`));
    }
    expect(offenders).toEqual([]);
  });
});

// F010/F011 functional: the reset-confirm call must rename resetToken -> token.
const apiMock = vi.fn<(url: string, opts?: { body?: string }) => Promise<unknown>>().mockResolvedValue({});
vi.mock("@/api/client", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/api/client")>();
  return { ...orig, api: (...a: Parameters<typeof apiMock>) => apiMock(...a) };
});

describe("useConfirmReset payload mapping (F011)", () => {
  it("sends token (not resetToken) in the confirm body", async () => {
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useConfirmReset(), { wrapper });
    await act(async () => {
      result.current.mutate({ resetToken: "tok-123", newPassword: "longenoughpass" });
    });
    const body = JSON.parse((apiMock.mock.calls[0]![1] as { body: string }).body);
    expect(body).toEqual({ token: "tok-123", newPassword: "longenoughpass" });
  });
});
