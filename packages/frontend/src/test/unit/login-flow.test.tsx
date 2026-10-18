import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useLogin } from "@/api/hooks/auth";
import { useOidcStatus } from "@/api/hooks/settings";

vi.mock("@/api/client", () => ({
  api: vi.fn(),
}));

import { api } from "@/api/client";
const mockApi = vi.mocked(api);

const adminUser = {
  id: "01a09acb-fbe7-7832-8d09-c05c1f8a521f",
  username: "admin",
  role: "ADMIN",
  displayName: "admin",
};

function makeWrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useLogin", () => {
  it("seeds the auth/session cache with the returned user so AuthGuard does not bounce", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Reproduce the pre-login state: an unauthenticated page load cached null.
    qc.setQueryData(["auth", "session"], null);

    mockApi.mockResolvedValueOnce({ user: adminUser, csrfToken: "tok" });

    const { result } = renderHook(() => useLogin(), { wrapper: makeWrapper(qc) });
    await result.current.mutateAsync({ username: "admin", password: "secret" });

    await waitFor(() => {
      expect(qc.getQueryData(["auth", "session"])).toEqual(adminUser);
    });
  });
});

describe("useOidcStatus", () => {
  it("queries the public /auth/oidc/status endpoint", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mockApi.mockResolvedValueOnce({ enabled: false });

    const { result } = renderHook(() => useOidcStatus(), { wrapper: makeWrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mockApi).toHaveBeenCalledWith("/auth/oidc/status");
  });
});
