import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProductsPage } from "@/pages/products";

vi.mock("@/api/hooks/auth", () => ({
  useSession: vi.fn(() => ({ data: { role: "EDITOR" } })),
}));
vi.mock("@/api/hooks/products", () => ({
  useProducts: vi.fn(),
  useCreateProduct: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUpdateProduct: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useDeleteProduct: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useAddEdge: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useRemoveEdge: vi.fn(() => ({ mutate: vi.fn() })),
  useBootstrapProducts: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));
vi.mock("@/api/hooks/org", () => ({
  useLobs: vi.fn(() => ({ data: { lobs: [] } })),
  useTeams: vi.fn(() => ({ data: { teams: [] } })),
}));

import { useProducts } from "@/api/hooks/products";
const mockUseProducts = vi.mocked(useProducts);

afterEach(cleanup);

const loaded = (products: unknown[] = [], edges: unknown[] = []) =>
  mockUseProducts.mockReturnValue({
    data: { products, edges },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useProducts>);

const renderPage = () =>
  render(
    <MemoryRouter>
      <ProductsPage />
    </MemoryRouter>,
  );

describe("ProductsPage", () => {
  it("shows skeleton while loading", () => {
    mockUseProducts.mockReturnValue({
      data: undefined,
      isPending: true,
      error: null,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProducts>);
    renderPage();
    expect(screen.getByTestId("table-skeleton")).toBeDefined();
  });

  it("shows empty state with create action for editors", () => {
    loaded();
    renderPage();
    expect(screen.getByTestId("empty-state")).toBeDefined();
    expect(screen.getAllByRole("button", { name: /new product/i }).length).toBeGreaterThan(0);
  });

  it("shows error state with retry", () => {
    mockUseProducts.mockReturnValue({
      data: undefined,
      isPending: false,
      error: { code: "X", message: "boom" },
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProducts>);
    renderPage();
    expect(screen.getByRole("alert")).toBeDefined();
  });

  it("renders the tree when data loads", () => {
    loaded(
      [
        {
          id: "p1",
          name: "Alpha",
          slug: "alpha",
          type: "PLATFORM",
          lifecycle: "ACTIVE",
        },
      ],
      [],
    );
    renderPage();
    expect(screen.getByTestId("product-tree")).toBeDefined();
    expect(screen.getByText("Alpha")).toBeDefined();
  });
});
