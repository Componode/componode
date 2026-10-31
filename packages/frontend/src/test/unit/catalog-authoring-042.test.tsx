import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import { ComponentCreateDialog } from "@/ux/components/catalog/component-create-dialog";
import { ComponentGroupCreateDialog } from "@/ux/components/catalog/component-group-create-dialog";
import { EdgeAuthoring } from "@/ux/components/products/edge-authoring";
import { UxSuggestionsPage } from "@/ux/app/suggestions";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const createComponentMutate = vi.fn();
const createGroupMutate = vi.fn();
const addEdgeMutate = vi.fn();
const removeEdgeMutate = vi.fn();
const sessionRole = { role: "EDITOR" as string };
const suggestionsImpl: { fn: (view: string) => unknown } = {
  fn: () => ({ data: { items: [], total: 0 }, isPending: false, error: null, refetch: vi.fn() }),
};

vi.mock("@/api/hooks/auth", () => ({
  useSession: vi.fn(() => ({ data: { id: "u1", username: "ed", role: sessionRole.role } })),
}));
vi.mock("@/api/hooks/components", () => ({
  useCreateComponent: vi.fn(() => ({ mutate: createComponentMutate, isPending: false })),
  useAllComponents: vi.fn(() => ({ data: [], isPending: false, error: null })),
}));
vi.mock("@/api/hooks/component-groups", () => ({
  useComponentGroups: vi.fn(() => ({ data: { groups: [] }, isPending: false, error: null })),
  useCreateComponentGroup: vi.fn(() => ({ mutate: createGroupMutate, isPending: false })),
}));
vi.mock("@/api/hooks/org", () => ({
  useTeams: vi.fn(() => ({ data: { teams: [{ id: "t1", name: "Payments" }] }, isPending: false })),
}));
vi.mock("@/api/hooks/products", () => ({
  useAddEdge: vi.fn(() => ({ mutate: addEdgeMutate, isPending: false })),
  useRemoveEdge: vi.fn(() => ({ mutate: removeEdgeMutate, isPending: false })),
  useProducts: vi.fn(() => ({
    data: {
      products: [
        { id: "p1", name: "Checkout", slug: "checkout", type: "BUSINESS_CAPABILITY", lifecycle: "ACTIVE" },
        { id: "p2", name: "Shared Platform", slug: "shared-platform", type: "PLATFORM", lifecycle: "ACTIVE" },
      ],
    },
    isPending: false,
  })),
}));
vi.mock("@/api/hooks/suggestions", () => ({
  useSuggestions: vi.fn((view: string) => suggestionsImpl.fn(view)),
  useAcceptSuggestion: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDismissSuggestion: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useRescanSuggestions: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

const wrap = (el: React.ReactElement) =>
  render(
    <MemoryRouter>
      <TooltipProvider>{el}</TooltipProvider>
    </MemoryRouter>,
  );

/** Radix Select: open the labelled combobox and click the item by its text. */
const pick = (triggerId: string, label: string) => {
  const trigger = document.getElementById(triggerId)!;
  fireEvent.keyDown(trigger, { key: "ArrowDown" });
  const item = Array.from(document.querySelectorAll('[data-slot="select-item"]')).find(
    (el) => el.textContent === label,
  )!;
  fireEvent.click(item);
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionRole.role = "EDITOR";
});
afterEach(cleanup);

describe("ComponentCreateDialog (spec 042, G29)", () => {
  it("derives the slug from the name and submits the create payload", () => {
    wrap(<ComponentCreateDialog />);
    fireEvent.click(screen.getByRole("button", { name: /add manually/i }));
    fireEvent.change(document.getElementById("cc-name")!, { target: { value: "Vendor CRM" } });
    expect((document.getElementById("cc-slug") as HTMLInputElement).value).toBe("vendor-crm");

    pick("cc-category", "API");
    pick("cc-provider", "Other");
    fireEvent.change(document.getElementById("cc-resource-type")!, { target: { value: "service" } });
    fireEvent.submit(document.getElementById("cc-name")!.closest("form")!);

    expect(createComponentMutate).toHaveBeenCalledWith(
      {
        name: "Vendor CRM",
        slug: "vendor-crm",
        category: "API",
        provider: "OTHER",
        resourceType: "service",
      },
      expect.anything(),
    );
  });

  it("keeps a manually-edited slug instead of re-deriving it", () => {
    wrap(<ComponentCreateDialog />);
    fireEvent.click(screen.getByRole("button", { name: /add manually/i }));
    fireEvent.change(document.getElementById("cc-slug")!, { target: { value: "custom-slug" } });
    fireEvent.change(document.getElementById("cc-name")!, { target: { value: "Renamed Later" } });
    expect((document.getElementById("cc-slug") as HTMLInputElement).value).toBe("custom-slug");
  });

  it("renders the server error inline (slug conflict)", () => {
    createComponentMutate.mockImplementation((_vars, opts) =>
      opts.onError({ code: "SLUG_CONFLICT", message: "Slug already in use; choose another" }),
    );
    wrap(<ComponentCreateDialog />);
    fireEvent.click(screen.getByRole("button", { name: /add manually/i }));
    fireEvent.change(document.getElementById("cc-name")!, { target: { value: "Vendor CRM" } });
    pick("cc-category", "API");
    pick("cc-provider", "Other");
    fireEvent.change(document.getElementById("cc-resource-type")!, { target: { value: "service" } });
    fireEvent.submit(document.getElementById("cc-name")!.closest("form")!);
    expect(screen.getByText("Slug already in use; choose another")).toBeTruthy();
  });

  it("blocks submit until required fields are filled", () => {
    wrap(<ComponentCreateDialog />);
    fireEvent.click(screen.getByRole("button", { name: /add manually/i }));
    fireEvent.change(document.getElementById("cc-name")!, { target: { value: "X" } });
    fireEvent.submit(document.getElementById("cc-name")!.closest("form")!);
    expect(screen.getByText("Category is required.")).toBeTruthy();
    expect(createComponentMutate).not.toHaveBeenCalled();
  });
});

describe("ComponentGroupCreateDialog (spec 042, G29)", () => {
  it("submits name + derived slug to useCreateComponentGroup", () => {
    wrap(<ComponentGroupCreateDialog />);
    fireEvent.click(screen.getByRole("button", { name: /new group/i }));
    fireEvent.change(document.getElementById("cg-name")!, { target: { value: "Payment Services" } });
    fireEvent.submit(document.getElementById("cg-name")!.closest("form")!);
    expect(createGroupMutate).toHaveBeenCalledWith(
      { name: "Payment Services", slug: "payment-services" },
      expect.anything(),
    );
  });
});

describe("EdgeAuthoring (spec 042, G31)", () => {
  const product = { id: "p0", name: "Checkout", slug: "checkout" };
  const edges = {
    composes: [{ id: "p9", name: "Cart Core", slug: "cart-core", type: "PLATFORM", lifecycle: "ACTIVE" }],
    consumesFrom: [],
    dependsOnComponents: [{ id: "c9", name: "orders-db", slug: "orders-db" }],
    dependsOnGroups: [],
  };

  it("lists current edges and removes one via useRemoveEdge", () => {
    wrap(<EdgeAuthoring product={product} {...edges} />);
    expect(screen.getByText("Cart Core")).toBeTruthy();
    expect(screen.getByText("orders-db")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Remove Cart Core" }));
    expect(removeEdgeMutate).toHaveBeenCalledWith(
      { id: "p0", kind: "composes", otherId: "p9" },
      expect.anything(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove orders-db" }));
    expect(removeEdgeMutate).toHaveBeenCalledWith(
      { id: "p0", kind: "depends-on", otherId: "c9", targetKind: "component" },
      expect.anything(),
    );
  });

  it("adds a composes edge with { childId } via useAddEdge", () => {
    wrap(<EdgeAuthoring product={product} {...edges} />);
    fireEvent.click(screen.getByRole("button", { name: /add relation/i }));
    pick("ea-target", "Shared Platform");
    fireEvent.submit(document.getElementById("ea-kind")!.closest("form")!);
    expect(addEdgeMutate).toHaveBeenCalledWith(
      { id: "p0", kind: "composes", body: { childId: "p2" } },
      expect.anything(),
    );
  });

  it("offers PLATFORM products only for consumes-from", () => {
    wrap(<EdgeAuthoring product={product} {...edges} />);
    fireEvent.click(screen.getByRole("button", { name: /add relation/i }));
    pick("ea-kind", "Consumes from");
    const trigger = document.getElementById("ea-target")!;
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const labels = Array.from(document.querySelectorAll('[data-slot="select-item"]')).map(
      (el) => el.textContent,
    );
    expect(labels).toEqual(["Shared Platform"]);
  });

  it("renders the server message inline when add fails (e.g. 409 CYCLE)", () => {
    addEdgeMutate.mockImplementation((_vars, opts) =>
      opts.onError({ code: "CYCLE", message: "Adding this edge would create a cycle" }),
    );
    wrap(<EdgeAuthoring product={product} {...edges} />);
    fireEvent.click(screen.getByRole("button", { name: /add relation/i }));
    pick("ea-target", "Shared Platform");
    fireEvent.submit(document.getElementById("ea-kind")!.closest("form")!);
    expect(screen.getByText("Adding this edge would create a cycle")).toBeTruthy();
  });

  it("hides authoring controls for VIEWER", () => {
    sessionRole.role = "VIEWER";
    wrap(<EdgeAuthoring product={product} {...edges} />);
    expect(screen.queryByRole("button", { name: /add relation/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove Cart Core" })).toBeNull();
    // edges remain readable
    expect(screen.getByText("Cart Core")).toBeTruthy();
  });
});

describe("UxSuggestionsPage — decided history (spec 042, G32)", () => {
  const pendingItem = {
    id: "s1",
    productId: "p1",
    componentId: "c1",
    reason: "NAME_MATCH",
    score: 1.2,
    status: "PENDING",
    createdAt: "2026-01-01T00:00:00Z",
    decidedAt: null,
    decidedBy: null,
    product: { id: "p1", name: "Checkout", slug: "checkout" },
    component: { id: "c1", name: "orders-db", slug: "orders-db", category: "DATABASE" },
    decidedByName: null,
  };
  const decidedItem = {
    ...pendingItem,
    id: "s2",
    status: "DISMISSED",
    decidedAt: "2026-01-02T00:00:00Z",
    decidedBy: "u1",
    decidedByName: "Ana Admin",
  };

  it("history tab lists decided rows with status + decider and no pending actions", () => {
    suggestionsImpl.fn = (view: string) =>
      view === "DECIDED"
        ? { data: { items: [decidedItem], total: 1 }, isPending: false, error: null, refetch: vi.fn() }
        : { data: { items: [pendingItem], total: 1 }, isPending: false, error: null, refetch: vi.fn() };

    wrap(<UxSuggestionsPage />);
    // Pending is the default view.
    expect(screen.getByText("orders-db")).toBeTruthy();

    const historyTab = screen.getByRole("tab", { name: /history/i });
    fireEvent.mouseDown(historyTab);
    fireEvent.focus(historyTab);
    expect(screen.getByText("Dismissed")).toBeTruthy();
    expect(screen.getByText(/Ana Admin/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /accept/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^dismiss$/i })).toBeNull();
  });

  it("history tab shows an empty state when nothing is decided", () => {
    suggestionsImpl.fn = (view: string) =>
      view === "DECIDED"
        ? { data: { items: [], total: 0 }, isPending: false, error: null, refetch: vi.fn() }
        : { data: { items: [pendingItem], total: 1 }, isPending: false, error: null, refetch: vi.fn() };

    wrap(<UxSuggestionsPage />);
    const historyTab = screen.getByRole("tab", { name: /history/i });
    fireEvent.mouseDown(historyTab);
    fireEvent.focus(historyTab);
    expect(screen.getByText("No decisions yet")).toBeTruthy();
  });
});
