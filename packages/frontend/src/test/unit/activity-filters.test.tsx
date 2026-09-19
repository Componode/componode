import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ActivityPage } from "@/pages/activity";

vi.mock("@/api/hooks/audit", () => ({
  useActivityFeed: vi.fn(() => ({
    data: { items: [], total: 0 },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  })),
}));

import { useActivityFeed } from "@/api/hooks/audit";
const mockUseActivityFeed = vi.mocked(useActivityFeed);

function lastQuery() {
  const calls = mockUseActivityFeed.mock.calls;
  return calls[calls.length - 1]![0] as { kind?: string };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ActivityPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ActivityPage kind facet (FR-006)", () => {
  it("renders kind as a facet control, not a plain select", () => {
    renderPage();
    expect(document.querySelector("[data-facet-control='Kind']")).not.toBeNull();
    expect(screen.getByRole("button", { name: /filter by kind/i })).toBeTruthy();
  });

  it("offers entity/edge options and emits a single kind value", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /filter by kind/i }));
    expect(await screen.findByRole("option", { name: /entity/i })).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: /edge/i }));
    expect(lastQuery().kind).toBe("edge");
  });

  it("selecting a second value replaces the first (single mode)", async () => {
    renderPage();
    const open = screen.getByRole("button", { name: /filter by kind/i });
    fireEvent.click(open);
    fireEvent.click(await screen.findByRole("option", { name: /entity/i }));
    fireEvent.keyDown(document.body, { key: "Escape" });
    fireEvent.click(open);
    fireEvent.click(await screen.findByRole("option", { name: /edge/i }));
    expect(lastQuery().kind).toBe("edge");
    const control = document.querySelector("[data-facet-control='Kind']")!;
    expect(control.textContent).toContain("Edge");
    expect(control.textContent).not.toContain("Entity");
  });
});
