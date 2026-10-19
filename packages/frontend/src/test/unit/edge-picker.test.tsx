import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EdgePicker } from "@/components/products/edge-picker";

vi.mock("@/api/hooks/products", () => ({
  useProducts: vi.fn(() => ({
    data: {
      products: [
        { id: "p2", name: "Other Product", type: "PLATFORM", lifecycle: "ACTIVE" },
      ],
      edges: [],
    },
  })),
}));
vi.mock("@/api/hooks/components", () => ({
  useAllComponents: vi.fn(() => ({
    data: [
      { id: "c1", name: "pg-main", lifecycle: "ACTIVE" },
      { id: "c2", name: "old-lib", lifecycle: "RETIRED" },
      { id: "c3", name: "redis-cache", lifecycle: "ACTIVE" },
      { id: "c4", name: "wired-already", lifecycle: "ACTIVE" },
    ],
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

function renderPicker(
  onAdd = vi.fn(async () => {}),
  extraProps: Record<string, unknown> = {},
) {
  render(
    <QueryClientProvider client={queryClient}>
      <EdgePicker
        open
        onClose={vi.fn()}
        target={{ kind: "depends-on", label: "Depends on component" }}
        productId="p1"
        onAdd={onAdd}
        {...extraProps}
      />
    </QueryClientProvider>,
  );
  return onAdd;
}

describe("EdgePicker depends-on (spec 019 FR-010 + spec 021 US3)", () => {
  it("lists active components as checkboxes and active groups as options, excluding retired", () => {
    renderPicker();
    expect(screen.getByRole("checkbox", { name: /pg-main/i })).toBeDefined();
    expect(screen.getByRole("checkbox", { name: /redis-cache/i })).toBeDefined();
    expect(screen.queryByRole("checkbox", { name: /old-lib/i })).toBeNull();
    expect(
      screen.getByRole("radio", { name: /datastores \(group · 3\)/i }),
    ).toBeDefined();
    expect(screen.queryByRole("radio", { name: /legacy/i })).toBeNull();
  });

  it("submits one componentIds[] request for multiple checked components", async () => {
    const onAdd = renderPicker();
    fireEvent.click(screen.getByRole("checkbox", { name: /pg-main/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /redis-cache/i }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await vi.waitFor(() => expect(onAdd).toHaveBeenCalledTimes(1));
    expect(onAdd).toHaveBeenCalledWith({ componentIds: ["c1", "c3"] });
  });

  it("submits componentGroupId and clears component selection when a group is picked", async () => {
    const onAdd = renderPicker();
    const cb = screen.getByRole("checkbox", { name: /pg-main/i }) as HTMLInputElement;
    fireEvent.click(cb);
    fireEvent.click(screen.getByRole("radio", { name: /datastores/i }));
    expect(cb.checked).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await vi.waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith({ componentGroupId: "g1" }),
    );
  });

  it("checking a component after a group deselects the group", () => {
    renderPicker();
    const radio = screen.getByRole("radio", { name: /datastores/i }) as HTMLInputElement;
    fireEvent.click(radio);
    fireEvent.click(screen.getByRole("checkbox", { name: /pg-main/i }));
    expect(radio.checked).toBe(false);
    expect(screen.getByRole("button", { name: "Add" })).toBeDefined();
  });

  it("renders already-wired components disabled rather than hidden", async () => {
    const onAdd = renderPicker(vi.fn(async () => {}), {
      existingComponentIds: ["c4"],
    });
    const wired = screen.getByRole("checkbox", {
      name: /wired-already/i,
    }) as HTMLInputElement;
    expect(wired.disabled).toBe(true);
    expect(screen.getByText(/already wired/i)).toBeDefined();
    // A disabled checkbox can't enter the selection.
    fireEvent.click(wired);
    fireEvent.click(screen.getByRole("checkbox", { name: /pg-main/i }));
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await vi.waitFor(() =>
      expect(onAdd).toHaveBeenCalledWith({ componentIds: ["c1"] }),
    );
  });

  it("keeps composes mode single-select", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <EdgePicker
          open
          onClose={vi.fn()}
          target={{ kind: "composes", label: "Composes" }}
          productId="p1"
          onAdd={vi.fn(async () => {})}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByLabelText("Select target")).toBeDefined();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });
});
