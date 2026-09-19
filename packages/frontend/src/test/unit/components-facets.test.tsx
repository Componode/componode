import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ComponentsPage } from "@/pages/components";

vi.mock("@/api/hooks/components", () => ({
  useComponents: vi.fn(),
  useComponentGroups: vi.fn(() => ({ data: { groups: [] } })),
}));

import { useComponents, useComponentGroups } from "@/api/hooks/components";
const mockUseComponents = vi.mocked(useComponents);
const mockUseComponentGroups = vi.mocked(useComponentGroups);

const pageResult = {
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
};

function renderPage(entry = "/components") {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ComponentsPage />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ComponentsPage faceted filters", () => {
  it("round-trips comma-joined facet params from the URL into pills", () => {
    mockUseComponents.mockReturnValue(pageResult as unknown as ReturnType<typeof useComponents>);
    renderPage("/components?category=REPOSITORY,DATABASE");
    expect(mockUseComponents).toHaveBeenCalledWith(
      expect.objectContaining({ category: "REPOSITORY,DATABASE" }),
    );
    expect(screen.getByText("Repository")).toBeDefined();
    expect(screen.getByText("Database")).toBeDefined();
  });

  it("offers all enum values in each enum facet", async () => {
    mockUseComponents.mockReturnValue(pageResult as unknown as ReturnType<typeof useComponents>);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /filter by category/i }));
    // Every core enum value is listed (25 categories)
    expect((await screen.findAllByRole("option")).length).toBeGreaterThanOrEqual(25);
  });

  it("serializes a facet selection as a comma-joined param without reload", async () => {
    mockUseComponents.mockReturnValue(pageResult as unknown as ReturnType<typeof useComponents>);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /filter by status/i }));
    fireEvent.click(await screen.findByText("Running"));
    expect(mockUseComponents).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "RUNNING", page: 1 }),
    );
  });

  it("clear-all empties every facet param", async () => {
    mockUseComponents.mockReturnValue(pageResult as unknown as ReturnType<typeof useComponents>);
    renderPage("/components?category=REPOSITORY&status=RUNNING");
    fireEvent.click(screen.getByRole("button", { name: /clear all/i }));
    const last = mockUseComponents.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(last.category).toBeUndefined();
    expect(last.status).toBeUndefined();
    expect(last.provider).toBeUndefined();
    expect(last.lifecycle).toBeUndefined();
    expect(last.group).toBeUndefined();
  });

  it("populates the group facet from useComponentGroups and filters by typeahead", async () => {
    mockUseComponents.mockReturnValue(pageResult as unknown as ReturnType<typeof useComponents>);
    const groups = Array.from({ length: 30 }, (_, i) => ({
      id: `g${i}`, name: `Group ${i}`, slug: `group-${i}`,
    }));
    groups[0] = { id: "g0", name: "Payments core", slug: "payments-core" };
    mockUseComponentGroups.mockReturnValue({
      data: { groups },
    } as unknown as ReturnType<typeof useComponentGroups>);
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /filter by group/i }));
    const input = await screen.findByPlaceholderText(/group/i);
    fireEvent.change(input, { target: { value: "payments" } });
    expect(await screen.findByText("Payments core")).toBeDefined();
    expect(screen.queryByText("Group 5")).toBeNull();
  });
});
