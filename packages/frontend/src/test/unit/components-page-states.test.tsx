import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ComponentsPage } from "@/pages/components";

vi.mock("@/api/hooks/components", () => ({
  useComponents: vi.fn(),
  useComponentGroups: vi.fn(() => ({ data: { groups: [] } })),
}));

import { useComponents } from "@/api/hooks/components";
const mockUseComponents = vi.mocked(useComponents);

afterEach(cleanup);

function renderPage() {
  return render(
    <MemoryRouter>
      <ComponentsPage />
    </MemoryRouter>,
  );
}

const emptyResult = {
  data: [],
  pagination: { page: 1, pageSize: 50, total: 0, pageCount: 0, hasNext: false },
};

describe("ComponentsPage states", () => {
  it("renders a table skeleton while loading", () => {
    mockUseComponents.mockReturnValue({ data: undefined, isPending: true, isFetching: true, error: null, refetch: vi.fn() } as unknown as ReturnType<typeof useComponents>);
    renderPage();
    expect(screen.getByTestId("table-skeleton")).toBeDefined();
    expect(screen.queryByText("Loading")).toBeNull();
  });

  it("renders an empty-state block when there are no components", () => {
    mockUseComponents.mockReturnValue({ data: emptyResult, isPending: false, isFetching: false, error: null, refetch: vi.fn() } as unknown as ReturnType<typeof useComponents>);
    renderPage();
    expect(screen.getByTestId("empty-state")).toBeDefined();
  });

  it("renders an error state with retry when the request fails", () => {
    mockUseComponents.mockReturnValue({ data: undefined, isPending: false, isFetching: false, error: { code: "X", message: "boom" }, refetch: vi.fn() } as unknown as ReturnType<typeof useComponents>);
    renderPage();
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByRole("button", { name: /retry/i })).toBeDefined();
  });

  it("renders the table when data loads", () => {
    mockUseComponents.mockReturnValue({
      data: {
        data: [
          {
            id: "c1", name: "payments-api", slug: "payments-api",
            category: "REPOSITORY", provider: "GITHUB", resourceType: "repo",
            lifecycle: "ACTIVE", componentGroupId: null, componentGroupName: null,
            instanceCount: 2,
          },
        ],
        pagination: { page: 1, pageSize: 50, total: 1, pageCount: 1, hasNext: false },
      },
      isPending: false, isFetching: false, error: null, refetch: vi.fn(),
    } as unknown as ReturnType<typeof useComponents>);
    renderPage();
    expect(screen.getByText("payments-api")).toBeDefined();
  });

  it("renders taxonomy pills as decorative (non-interactive, muted treatment)", () => {
    mockUseComponents.mockReturnValue({
      data: {
        data: [
          {
            id: "c1", name: "payments-api", slug: "payments-api",
            category: "REPOSITORY", provider: "GITHUB", resourceType: "repo",
            lifecycle: "ACTIVE", componentGroupId: null, componentGroupName: null,
            instanceCount: 2,
          },
        ],
        pagination: { page: 1, pageSize: 50, total: 1, pageCount: 1, hasNext: false },
      },
      isPending: false, isFetching: false, error: null, refetch: vi.fn(),
    } as unknown as ReturnType<typeof useComponents>);
    renderPage();
    for (const el of [screen.getByText("REPOSITORY"), screen.getByText("GITHUB")]) {
      expect(el.tagName).not.toBe("A");
      expect(el.tagName).not.toBe("BUTTON");
      expect(el.getAttribute("href")).toBeNull();
      expect(el.getAttribute("tabindex")).toBeNull();
      expect(el.className).toMatch(/bg-muted/);
    }
  });
});
