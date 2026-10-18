import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ProductDetailPage } from "@/pages/product-detail";

vi.mock("@/api/hooks/audit", () => ({
  useEntityHistory: vi.fn(() => ({ isPending: false, data: null, error: null, refetch: vi.fn() })),
  useActivityFeed: vi.fn(() => ({ isPending: false, data: null, error: null, refetch: vi.fn() })),
  useRunChanges: vi.fn(() => ({ isPending: false, data: null, error: null, refetch: vi.fn() })),
  useCreateCorrection: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));

vi.mock("@/api/hooks/auth", () => ({
  useSession: vi.fn(() => ({ data: { role: "EDITOR" } })),
}));
vi.mock("@/api/hooks/products", () => ({
  useProduct: vi.fn(),
  useProducts: vi.fn(() => ({ data: { products: [], edges: [] } })),
  useCreateProduct: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUpdateProduct: vi.fn(() => ({ mutateAsync: vi.fn(), mutate: vi.fn(), isPending: false })),
  useDeleteProduct: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useAddEdge: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useRemoveEdge: vi.fn(() => ({ mutate: vi.fn() })),
}));
vi.mock("@/api/hooks/org", () => ({
  useLobs: vi.fn(() => ({ data: { lobs: [] } })),
  useTeams: vi.fn(() => ({ data: { teams: [] } })),
}));
vi.mock("@/api/hooks/components", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  useComponents: vi.fn(() => ({ data: { data: [] } })),
}));
vi.mock("@/components/layout/crumb-context", () => ({
  useSetCrumbLabel: vi.fn(),
}));

import { useProduct } from "@/api/hooks/products";
const mockUseProduct = vi.mocked(useProduct);

afterEach(cleanup);

const detail = {
  product: {
    id: "p1",
    name: "Payments",
    slug: "payments",
    type: "BUSINESS_CAPABILITY",
    lifecycle: "ACTIVE",
    lobOwnerName: null,
    teamOwnerName: null,
    updatedAt: new Date().toISOString(),
  },
  health: {
    status: "ERROR",
    perEnv: { PRODUCTION: "ERROR", DEV: "RUNNING" },
    sourceCount: 2,
  },
  composedBy: [],
  composes: [{ id: "p2", name: "Child P", slug: "child-p", type: "PLATFORM", lifecycle: "ACTIVE" }],
  consumesFrom: [],
  consumedBy: [],
  components: {
    declared: [],
    inherited: [
      {
        id: "c1",
        name: "dep-lib",
        slug: "dep-lib",
        category: "LIBRARY",
        lifecycle: "ACTIVE",
        sources: [
          {
            kind: "INHERITED",
            product: { id: "p2", name: "Child P", slug: "child-p" },
          },
        ],
      },
    ],
  },
  dependsOnGroups: [],
  instances: { declared: [], inherited: [] },
  counts: { composedBy: 0, composes: 1, components: 1, instances: 0 },
};

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

const renderPage = () =>
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/products/payments"]}>
        <Routes>
          <Route path="/products/:slug" element={<ProductDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("ProductDetailPage", () => {
  it("renders header + overview with counts", () => {
    mockUseProduct.mockReturnValue({
      data: detail,
      isPending: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProduct>);
    renderPage();
    expect(screen.getByRole("heading", { name: "Payments" })).toBeDefined();
    expect(screen.getByRole("tab", { name: "Composition" })).toBeDefined();
    expect(screen.getByText(/Composes: 1/)).toBeDefined();
  });

  it("renders the health badge and per-env breakdown (spec 019)", () => {
    mockUseProduct.mockReturnValue({
      data: detail,
      isPending: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProduct>);
    renderPage();
    expect(screen.getByText("Health:")).toBeDefined();
    expect(screen.getAllByText("ERROR").length).toBeGreaterThan(0);
    expect(screen.getByText("DEV")).toBeDefined();
  });

  it("renders muted — when health is null", () => {
    mockUseProduct.mockReturnValue({
      data: { ...detail, health: null },
      isPending: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProduct>);
    renderPage();
    expect(screen.getByText("Health:")).toBeDefined();
    expect(screen.queryByText("ERROR")).toBeNull();
  });

  it("composition tab shows labeled sections; components tab shows Declared/Inherited", () => {
    mockUseProduct.mockReturnValue({
      data: detail,
      isPending: false,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProduct>);
    renderPage();
    fireEvent.click(screen.getByRole("tab", { name: "Composition" }));
    expect(screen.getByText("Composes")).toBeDefined();
    expect(screen.getByText("Child P")).toBeDefined();
    fireEvent.click(screen.getByRole("tab", { name: "Components" }));
    expect(screen.getByText("Inherited")).toBeDefined();
    expect(screen.getByText("dep-lib")).toBeDefined();
    expect(screen.getByText("Child P")).toBeDefined(); // via provenance
  });

  it("shows error state on failure", () => {
    mockUseProduct.mockReturnValue({
      data: undefined,
      isPending: false,
      error: { code: "NOT_FOUND", message: "missing" },
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProduct>);
    renderPage();
    expect(screen.getByText("Product not found")).toBeDefined();
  });
});
