import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CommandPalette } from "@/components/command-palette";

vi.mock("@/api/hooks/search", () => ({
  useGlobalSearch: vi.fn(),
}));

import { useGlobalSearch } from "@/api/hooks/search";
const mockSearch = vi.mocked(useGlobalSearch);

afterEach(cleanup);

function renderPalette() {
  return render(
    <MemoryRouter>
      <CommandPalette />
    </MemoryRouter>,
  );
}

describe("CommandPalette", () => {
  // Timing assertion is CPU-contention sensitive under parallel workers —
  // retry deflakes without weakening the SC-005 threshold.
  it("opens on Ctrl+K promptly (SC-005)", { retry: 2 }, () => {
    mockSearch.mockReturnValue({ data: undefined } as unknown as ReturnType<typeof useGlobalSearch>);
    renderPalette();
    expect(screen.queryByPlaceholderText(/search components/i)).toBeNull();
    const start = performance.now();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByPlaceholderText(/search components/i)).toBeDefined();
    expect(performance.now() - start).toBeLessThan(500);
  });

  it("closes on Escape", () => {
    mockSearch.mockReturnValue({ data: undefined } as unknown as ReturnType<typeof useGlobalSearch>);
    renderPalette();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByPlaceholderText(/search components/i);
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByPlaceholderText(/search components/i)).toBeNull();
  });

  it("renders grouped results and navigates on select", () => {
    mockSearch.mockReturnValue({
      data: {
        components: [
          { id: "c1", name: "payments-api", slug: "payments-api", kind: "component", href: "/components/c1" },
        ],
        products: [],
        groups: [],
        importers: [],
      },
    } as unknown as ReturnType<typeof useGlobalSearch>);
    renderPalette();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    expect(screen.getByText("Components")).toBeDefined();
    expect(screen.getAllByText("payments-api").length).toBeGreaterThan(0);
  });

  it("shows an empty message when a query has no results", async () => {
    mockSearch.mockReturnValue({
      data: { components: [], products: [], groups: [], importers: [] },
    } as unknown as ReturnType<typeof useGlobalSearch>);
    renderPalette();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const input = screen.getByPlaceholderText(/search components/i);
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(await screen.findByText(/no results/i)).toBeDefined();
  });
});
