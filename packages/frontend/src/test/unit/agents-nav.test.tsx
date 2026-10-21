import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "@/components/layout/sidebar";

// Spec 025 US4: agent management is ADMIN-only — the nav entry must not
// render for other roles (the API enforces it too; this guards the UX side).

vi.mock("@/api/hooks/auth", () => ({
  useSession: vi.fn(),
}));

import { useSession } from "@/api/hooks/auth";
const mockUseSession = vi.mocked(useSession);

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

function asRole(role: string) {
  mockUseSession.mockReturnValue({
    data: { id: "1", username: "user", role },
  } as ReturnType<typeof useSession>);
  return render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  );
}

describe("Import Agents nav gating", () => {
  it("shows the Import Agents link to admins", () => {
    asRole("ADMIN");
    const link = screen.getByText("Import Agents").closest("a");
    expect(link?.getAttribute("href")).toBe("/agents");
  });

  it("hides the Import Agents link from non-admin users", () => {
    asRole("EDITOR");
    expect(screen.queryByText("Import Agents")).toBeNull();
  });
});
