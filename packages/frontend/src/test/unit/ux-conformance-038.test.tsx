import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import { AGENT_DISCONNECT_REASONS } from "@componode/core";
import { UsersTable } from "@/ux/components/admin/users-table";
import { UxLobDetailPage } from "@/ux/app/lobs/$slug";
import { mapActivityItem } from "@/api/mappers/dashboard";
import { mapCredentialStatus } from "@/api/mappers/operations";
import { DISCONNECT_REASON_META } from "@/ux/lib/domain";

const resetMutate = vi.fn();
const updateUserMutate = vi.fn();
const updateLobMutate = vi.fn();
const deleteLobMutate = vi.fn();

vi.mock("@/api/hooks/users", () => ({
  useUpdateUser: () => ({ mutate: updateUserMutate, isPending: false }),
}));
vi.mock("@/api/hooks/password", () => ({
  useResetPassword: () => ({ mutate: resetMutate, isPending: false }),
}));
vi.mock("@/api/hooks/products", () => ({
  useProducts: () => ({ data: { products: [] }, isPending: false }),
}));
vi.mock("@/api/hooks/org", () => ({
  useLob: () => ({
    data: { lob: { id: "l1", name: "Payments", slug: "payments", description: "" } },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
  useUpdateLob: () => ({ mutate: updateLobMutate, isPending: false }),
  useDeleteLob: () => ({ mutate: deleteLobMutate, isPending: false }),
  useTeams: () => ({
    data: {
      teams: [
        { id: "t1", name: "Acquiring", lobId: "l1" },
        { id: "t2", name: "Issuing", lobId: "l1" },
        { id: "t3", name: "Other LOB team", lobId: "other" },
      ],
    },
    isPending: false,
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeAll(() => {
  // jsdom lacks the pointer-capture APIs Radix menus use.
  if (typeof Element !== "undefined") {
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.setPointerCapture ??= () => {};
    Element.prototype.releasePointerCapture ??= () => {};
  }
});

describe("spec 038 — UX conformance regression tests", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("T008: users-table 'Send password reset' calls useResetPassword with the row's user id", () => {
    const user = {
      id: "u2",
      username: "ada",
      displayName: "Ada",
      email: "ada@example.com",
      role: "EDITOR",
      isActive: true,
      lastActiveAt: null,
    } as never;

    render(
      <MemoryRouter>
        <TooltipProvider>
          <UsersTable data={[user]} selfId="me" />
        </TooltipProvider>
      </MemoryRouter>,
    );

    const trigger = screen.getByLabelText("Actions for Ada");
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByText("Send password reset"));

    expect(resetMutate).toHaveBeenCalledWith({ userId: "u2" }, expect.anything());
  });

  it("T009: LOB delete guard counts associated teams as well as products", () => {
    render(
      <MemoryRouter initialEntries={["/lobs/payments"]}>
        <TooltipProvider>
          <Routes>
            <Route path="/lobs/:slug" element={<UxLobDetailPage />} />
          </Routes>
        </TooltipProvider>
      </MemoryRouter>,
    );

    // 2 associated teams + 0 products — the reason must name both, not
    // collapse to the old products-only count.
    expect(
      screen.getByText("Move its 2 teams and 0 products elsewhere before deleting."),
    ).toBeTruthy();
  });

  it("FR-003: DISCONNECT_REASON_META covers every core disconnect reason", () => {
    for (const reason of AGENT_DISCONNECT_REASONS) {
      const meta = DISCONNECT_REASON_META[reason];
      expect(meta, `missing META for ${reason}`).toBeTruthy();
      expect(meta.label.length).toBeGreaterThan(0);
    }
  });

  it("FR-009: feed summaries render human sentences, not raw change keys", () => {
    const view = mapActivityItem({
      kind: "entity",
      id: "e1",
      entityType: "component",
      entityId: "c1",
      entityName: "payments-db",
      action: "updated",
      changes: { name: { from: "old-db", to: "payments-db" }, owner: { from: "a", to: "b" } },
      createdByName: "admin",
      createdAt: "2026-02-01T00:00:00Z",
    } as never);
    expect(view.summary).toContain("name changed from old-db to payments-db");
    expect(view.summary).not.toBe("name; owner");
  });

  it("FR-013: a null credential status never upgrades to ACTIVE", () => {
    expect(mapCredentialStatus(null)).not.toBe("ACTIVE");
    expect(mapCredentialStatus("REVOKED")).toBe("REVOKED");
  });
});
