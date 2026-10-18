import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EdgePicker } from "@/components/products/edge-picker";

vi.mock("@/api/hooks/products", () => ({
  useProducts: vi.fn(() => ({ data: { products: [], edges: [] } })),
}));
vi.mock("@/api/hooks/components", () => ({
  useComponents: vi.fn(() => ({
    data: {
      data: [
        { id: "c1", name: "pg-main", lifecycle: "ACTIVE" },
        { id: "c2", name: "old-lib", lifecycle: "RETIRED" },
      ],
    },
  })),
}));
vi.mock("@/api/hooks/component-groups", () => ({
  useComponentGroups: vi.fn(() => ({
    data: {
      groups: [
        { id: "g1", name: "datastores", lifecycle: "ACTIVE", memberCount: 3 },
        { id: "g2", name: "legacy", lifecycle: "RETIRED", memberCount: 1 },
      ],
    },
  })),
}));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});

afterEach(cleanup);

function renderPicker(onAdd = vi.fn(async () => {})) {
  render(
    <QueryClientProvider client={queryClient}>
      <EdgePicker
        open
        onClose={vi.fn()}
        target={{ kind: "depends-on", label: "Depends on component" }}
        productId="p1"
        onAdd={onAdd}
      />
    </QueryClientProvider>,
  );
  return onAdd;
}

describe("EdgePicker depends-on (spec 019, FR-010)", () => {
  it("lists groups alongside components with (group · N) labels, excluding retired", () => {
    renderPicker();
    const select = screen.getByLabelText("Select target") as HTMLSelectElement;
    const labels = [...select.options].map((o) => o.label);
    expect(labels).toContain("pg-main");
    expect(labels).toContain("datastores (group · 3)");
    expect(labels).not.toContain("old-lib"); // RETIRED component
    expect(labels).not.toContain("legacy (group · 1)"); // RETIRED group
  });

  it("submits componentGroupId when a group option is chosen", async () => {
    const onAdd = renderPicker();
    const select = screen.getByLabelText("Select target");
    fireEvent.change(select, { target: { value: "g1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await vi.waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith({ componentGroupId: "g1" }),
    );
  });

  it("submits componentId when a component option is chosen", async () => {
    const onAdd = renderPicker();
    const select = screen.getByLabelText("Select target");
    fireEvent.change(select, { target: { value: "c1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await vi.waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith({ componentId: "c1" }),
    );
  });
});
