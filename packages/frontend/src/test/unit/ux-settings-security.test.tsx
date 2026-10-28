import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import { UxSettingsSecurityPage } from "@/ux/app/settings/security";

vi.mock("@/ux/components/app/session-context", () => ({
  useSession: () => ({ user: { username: "ada", displayName: "Ada", role: "ADMIN" } }),
  SessionProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/api/hooks/password", () => ({
  useChangePassword: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/api/hooks/sessions", () => ({
  useSessions: () => ({ data: { sessions: [] }, isPending: false }),
  useRevokeSession: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

describe("Security settings — password policy (F003, bugfix 036)", () => {
  afterEach(cleanup);

  const renderPage = () =>
    render(
      <MemoryRouter>
        <TooltipProvider>
          <UxSettingsSecurityPage />
        </TooltipProvider>
      </MemoryRouter>,
    );

  it("new-password enforces the ratified 12-char minimum", () => {
    renderPage();
    const input = document.getElementById("new-password") as HTMLInputElement;
    expect(input.minLength).toBe(12);
  });

  it("states the 12-char policy where users set passwords", () => {
    renderPage();
    expect(screen.getByText(/at least 12 characters/i)).toBeTruthy();
  });
});
