import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import { SessionsTable } from "@/ux/components/admin/sessions-table";
import type { Session } from "@/ux/lib/view-types";

vi.mock("@/api/hooks/sessions", () => ({
  useRevokeSession: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const base: Session = {
  id: "s1",
  username: "estevan",
  displayName: "Estevan",
  device: "Chrome · Windows",
  location: "192.168.1.10",
  createdAt: new Date().toISOString(),
  lastSeenAt: new Date().toISOString(),
  expiresAt: new Date().toISOString(),
  current: false,
};

const wrap = (data: Session[]) =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <SessionsTable data={data} />
      </TooltipProvider>
    </MemoryRouter>,
  );

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("SessionsTable — session visibility (spec 032, G2)", () => {
  it("renders device, owner, and location columns with live values", () => {
    wrap([base]);
    expect(screen.getByText("Device")).toBeTruthy();
    expect(screen.getByText("User")).toBeTruthy();
    expect(screen.getByText("Location")).toBeTruthy();
    expect(screen.getByText("Chrome · Windows")).toBeTruthy();
    expect(screen.getByText("192.168.1.10")).toBeTruthy();
    expect(screen.getByText("Estevan")).toBeTruthy();
  });

  it("marks the caller's session and suppresses its revoke action", () => {
    wrap([
      base,
      { ...base, id: "s2", displayName: "Estevan (other)", current: true },
    ]);
    expect(screen.getByText("This device")).toBeTruthy();
    expect(screen.getByText("Current")).toBeTruthy();
    // one revoke button remains — for the non-current session
    expect(screen.getAllByText("Revoke")).toHaveLength(1);
  });
});
