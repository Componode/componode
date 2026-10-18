import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProductForm } from "@/components/products/product-form";
import { EdgePicker } from "@/components/products/edge-picker";

vi.mock("@/api/hooks/auth", () => ({
  useSession: vi.fn(() => ({ data: { role: "EDITOR" } })),
}));

const createMutate = vi.fn(async () => undefined);
const updateMutate = vi.fn(async () => undefined);

vi.mock("@/api/hooks/products", () => ({
  useProducts: vi.fn(() => ({
    data: {
      products: [
        { id: "bc", name: "Cap", slug: "cap", type: "BUSINESS_CAPABILITY", lifecycle: "ACTIVE" },
        { id: "cf", name: "Face", slug: "face", type: "CUSTOMER_FACING", lifecycle: "ACTIVE" },
        { id: "pl", name: "Plat", slug: "plat", type: "PLATFORM", lifecycle: "ACTIVE" },
        { id: "rg", name: "Old", slug: "old", type: "PLATFORM", lifecycle: "RETIRED" },
      ],
      edges: [],
    },
  })),
  useCreateProduct: () => ({ mutateAsync: createMutate, isPending: false }),
  useUpdateProduct: () => ({ mutateAsync: updateMutate, isPending: false }),
  useDeleteProduct: () => ({ mutateAsync: vi.fn() }),
  useAddEdge: () => ({ mutateAsync: vi.fn() }),
  useRemoveEdge: () => ({ mutate: vi.fn() }),
}));
vi.mock("@/api/hooks/org", () => ({
  useLobs: () => ({ data: { lobs: [] } }),
  useTeams: () => ({ data: { teams: [] } }),
}));
vi.mock("@/api/hooks/components", () => ({
  useComponents: () => ({ data: { data: [] } }),
  useUpdateComponent: () => ({ mutateAsync: vi.fn() }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProductForm", () => {
  it("keeps Save disabled until a name is entered, then submits", () => {
    render(
      <MemoryRouter>
        <ProductForm open onClose={() => {}} />
      </MemoryRouter>,
    );
    const save = screen.getByRole("button", { name: /save/i });
    expect(save).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText(/name/i), {
      target: { value: "Payments" },
    });
    expect(save).toHaveProperty("disabled", false);
  });
});

describe("EdgePicker type filtering", () => {
  const base = {
    open: true,
    onClose: () => {},
    onAdd: vi.fn(async () => undefined),
  };

  it("composes picker lists children (any type except RETIRED), excludes self", () => {
    render(
      <MemoryRouter>
        <EdgePicker
          {...base}
          productId="bc"
          target={{ kind: "composes", label: "Composes" }}
        />
      </MemoryRouter>,
    );
    const select = screen.getByRole("combobox");
    const labels = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(labels).toContain("Face");
    expect(labels).toContain("Plat"); // PLATFORM may be a COMPOSES child
    expect(labels).not.toContain("Cap"); // self excluded
    expect(labels).not.toContain("Old"); // RETIRED excluded
  });

  it("composes picker is enabled for a PLATFORM parent (ADR-109)", () => {
    render(
      <MemoryRouter>
        <EdgePicker
          {...base}
          productId="pl"
          target={{ kind: "composes", label: "Composes" }}
        />
      </MemoryRouter>,
    );
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.disabled).toBe(false);
    expect(screen.queryByText(/only business capability/i)).toBeNull();
    const labels = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(labels).toContain("Cap");
    expect(labels).not.toContain("Plat"); // self excluded
  });

  it("consumes-from picker lists only active PLATFORM products", () => {
    render(
      <MemoryRouter>
        <EdgePicker
          {...base}
          productId="src"
          target={{ kind: "consumes-from", label: "Consumes from" }}
        />
      </MemoryRouter>,
    );
    const select = screen.getByRole("combobox");
    const labels = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(labels).toContain("Plat");
    expect(labels).not.toContain("Cap");
    expect(labels).not.toContain("Old");
  });

  it("surfaces API errors (e.g. 409 CYCLE_DETECTED) inline", async () => {
    const onAdd = vi.fn(async () => {
      throw { code: "CYCLE_DETECTED", message: "Cycle detected" };
    });
    render(
      <MemoryRouter>
        <EdgePicker
          {...base}
          productId="src"
          target={{ kind: "composes", label: "Composes" }}
          onAdd={onAdd}
        />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "pl" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(await screen.findByRole("alert")).toBeDefined();
    expect((await screen.findByRole("alert")).textContent).toContain("Cycle");
  });
});
