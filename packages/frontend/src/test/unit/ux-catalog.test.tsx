import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import { UxProductsPage } from "@/ux/app/products/index";
import { UxProductDetailPage } from "@/ux/app/products/$slug";
import { UxComponentsPage } from "@/ux/app/components/index";
import { UxComponentDetailPage } from "@/ux/app/components/$slug";
import { UxSuggestionsPage } from "@/ux/app/suggestions";

vi.mock("@/api/hooks/auth", () => ({
  useSession: vi.fn(() => ({ data: { role: "ADMIN", username: "a", displayName: "A" } })),
  useLogout: vi.fn(() => ({ mutate: vi.fn() })),
}));
vi.mock("@/api/hooks/products", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/hooks/products")>()),
  useProducts: vi.fn(),
  useAllProducts: vi.fn(() => ({ data: [], isPending: false, error: null })),
  useProduct: vi.fn(),
  useUpdateProduct: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDeleteProduct: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));
vi.mock("@/api/hooks/components", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/hooks/components")>()),
  useComponents: vi.fn(),
  useAllComponents: vi.fn(),
  useComponentDetail: vi.fn(),
  useCreateComponent: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));
vi.mock("@/api/hooks/component-groups", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/hooks/component-groups")>()),
  useComponentGroups: vi.fn(() => ({ data: { data: [], pagination: { page: 1, pageSize: 25, total: 0, pageCount: 0, hasNext: false } }, isPending: false, error: null })),
  useAllComponentGroups: vi.fn(() => ({ data: [], isPending: false, error: null })),
  useCreateComponentGroup: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));
vi.mock("@/api/hooks/org", () => ({
  useTeams: vi.fn(() => ({ data: { teams: [] }, isPending: false, error: null })),
  useLobs: vi.fn(() => ({ data: { lobs: [] }, isPending: false, error: null })),
}));
vi.mock("@/api/hooks/audit", () => ({
  useEntityHistory: vi.fn(() => ({ data: { items: [] }, isPending: false, error: null })),
  useActivityFeed: vi.fn(() => ({ data: { items: [] }, isPending: false, error: null })),
}));
vi.mock("@/api/hooks/suggestions", async (importOriginal) => ({
  // Keep the real sort keys + list-params adapter — the page reads them;
  // only the query hooks are stubbed.
  ...(await importOriginal<typeof import("@/api/hooks/suggestions")>()),
  useSuggestions: vi.fn(),
  useAcceptSuggestion: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useDismissSuggestion: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));
vi.mock("@/ux/components/products/product-map", () => ({ ProductMap: () => null }));

import { useProduct, useProducts } from "@/api/hooks/products";
import { useAllComponents, useComponentDetail, useComponents } from "@/api/hooks/components";
import { useSuggestions } from "@/api/hooks/suggestions";

const wrap = (el: React.ReactElement, entry = "/ux") =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <TooltipProvider>{el}</TooltipProvider>
    </MemoryRouter>,
  );

const apiProduct = {
  id: "p1", name: "Checkout", slug: "checkout", type: "CUSTOMER_FACING",
  lifecycle: "ACTIVE", createdAt: "x", updatedAt: "2026-02-01T00:00:00Z",
};

const apiComponent = {
  id: "c1", name: "orders-db", slug: "orders-db", category: "DATABASE",
  provider: "AWS", resourceType: "rds:db", lifecycle: "ACTIVE",
  componentGroups: [], instanceCount: 1,
};

const EMPTY_PAGE = { page: 1, pageSize: 25, total: 0, pageCount: 0, hasNext: false };

beforeEach(() => {
  vi.mocked(useProducts).mockReturnValue({ data: { data: [], edges: [], pagination: EMPTY_PAGE }, isPending: false, error: null } as never);
  vi.mocked(useAllComponents).mockReturnValue({ data: [], isPending: false, error: null } as never);
  vi.mocked(useComponents).mockReturnValue({ data: { data: [], pagination: EMPTY_PAGE }, isPending: false, error: null } as never);
  vi.mocked(useSuggestions).mockReturnValue({ data: { items: [] }, isPending: false, error: null } as never);
});

afterEach(cleanup);

describe("UxProductsPage states", () => {
  it("renders skeleton while loading", () => {
    vi.mocked(useProducts).mockReturnValue({ isPending: true, error: null } as never);
    const { container } = wrap(<UxProductsPage />);
    expect(container.querySelector("[aria-busy]")).toBeTruthy();
  });

  it("renders error state with retry", () => {
    vi.mocked(useProducts).mockReturnValue({ isPending: false, error: new Error("boom"), refetch: vi.fn() } as never);
    wrap(<UxProductsPage />);
    expect(screen.getByText("Products unavailable")).toBeTruthy();
  });

  it("renders rows from live data", () => {
    vi.mocked(useProducts).mockReturnValue({
      data: { data: [apiProduct], edges: [], pagination: { ...EMPTY_PAGE, total: 1, pageCount: 1 } }, isPending: false, error: null,
    } as never);
    wrap(<UxProductsPage />);
    expect(screen.getByText("Checkout")).toBeTruthy();
  });
});

describe("UxProductDetailPage states", () => {
  it("renders not-found on NOT_FOUND error", () => {
    vi.mocked(useProduct).mockReturnValue({
      isPending: false, error: { code: "NOT_FOUND", message: "nope" }, refetch: vi.fn(),
    } as never);
    wrap(<UxProductDetailPage />, "/ux/products/zzz");
    expect(screen.getByText("Product not found")).toBeTruthy();
  });

  it("renders detail on live data", () => {
    vi.mocked(useProduct).mockReturnValue({
      isPending: false, error: null,
      data: {
        product: apiProduct, health: null, composedBy: [], composes: [],
        consumesFrom: [], consumedBy: [], components: { declared: [], inherited: [] },
        dependsOnGroups: [], instances: { declared: [], inherited: [] },
        counts: { composedBy: 0, composes: 0, components: 0, instances: 0 },
      },
    } as never);
    wrap(<UxProductDetailPage />, "/ux/products/checkout");
    expect(screen.getByText("Checkout")).toBeTruthy();
  });
});

describe("UxComponentsPage", () => {
  it("renders rows from the paged useComponents envelope", () => {
    vi.mocked(useComponents).mockReturnValue({
      data: { data: [apiComponent], pagination: { ...EMPTY_PAGE, total: 1, pageCount: 1 } },
      isPending: false, error: null,
    } as never);
    wrap(<UxComponentsPage />);
    expect(screen.getByText("orders-db")).toBeTruthy();
  });
});

describe("UxComponentDetailPage", () => {
  it("renders not-found for an unknown slug", () => {
    vi.mocked(useComponents).mockReturnValue({ data: { data: [] }, isPending: false, isSuccess: true, error: null } as never);
    vi.mocked(useComponentDetail).mockReturnValue({ isPending: false, error: null } as never);
    wrap(<UxComponentDetailPage />, "/ux/components/zzz");
    expect(screen.getByText("Component not found")).toBeTruthy();
  });
});

describe("UxSuggestionsPage", () => {
  it("renders the caught-up empty state", () => {
    wrap(<UxSuggestionsPage />);
    expect(screen.getByText("You're all caught up")).toBeTruthy();
  });
});
