import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const useAuthSession = vi.fn();
vi.mock("@/api/hooks/auth", () => ({ useSession: () => useAuthSession() }));

import { SessionProvider } from "@/ux/components/app/session-context";

const wrap = (entry = "/") =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/"
          element={
            <SessionProvider>
              <div>SHELL CONTENT</div>
            </SessionProvider>
          }
        />
        <Route path="/login" element={<div>LOGIN PAGE</div>} />
      </Routes>
    </MemoryRouter>,
  );

const user = {
  id: "u1",
  username: "ada",
  displayName: "Ada",
  email: null,
  role: "ADMIN",
  isActive: true,
  createdAt: new Date().toISOString(),
};

describe("SessionProvider — expired-session redirect (F001, bugfix 036)", () => {
  afterEach(cleanup);

  it("redirects to /login when the session resolves to null", () => {
    useAuthSession.mockReturnValue({ data: null, isPending: false });
    wrap();
    expect(screen.getByText("LOGIN PAGE")).toBeTruthy();
    expect(screen.queryByText("SHELL CONTENT")).toBeNull();
  });

  it("renders a loading state while the session is pending", () => {
    useAuthSession.mockReturnValue({ data: undefined, isPending: true });
    wrap();
    expect(screen.queryByText("SHELL CONTENT")).toBeNull();
    expect(screen.queryByText("LOGIN PAGE")).toBeNull();
    expect(document.querySelector("[data-slot='spinner'], .animate-spin, svg")).toBeTruthy();
  });

  it("renders children when a session exists", () => {
    useAuthSession.mockReturnValue({ data: user, isPending: false });
    wrap();
    expect(screen.getByText("SHELL CONTENT")).toBeTruthy();
  });
});
