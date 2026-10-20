import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DashboardPage } from "@/pages/dashboard";
import { ComponentsPage } from "@/pages/components";
import { ProductsPage } from "@/pages/products";

// ---------- shared hook mocks ----------

vi.mock("@/api/hooks/dashboard", () => ({
  useDashboardSummary: vi.fn(),
}));
vi.mock("@/api/hooks/components", () => ({
  useComponents: vi.fn(),
  useComponentGroups: vi.fn(() => ({ data: { groups: [] } })),
  usePlatformCandidates: () => ({ data: [], isPending: false, error: null }),
  useComponentDependents: () => ({ data: [], isPending: false, error: null }),
  usePromoteComponent: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/api/hooks/products", () => ({
  useProducts: vi.fn(),
  useCreateProduct: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useUpdateProduct: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
  useBootstrapProducts: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));
vi.mock("@/api/hooks/auth", () => ({
  useSession: () => ({ data: { role: "ADMIN" } }),
}));
vi.mock("@/api/hooks/org", () => ({
  useLobs: () => ({ data: { lobs: [] } }),
  useTeams: () => ({ data: { teams: [] } }),
}));
vi.mock("@/components/importer-run-chart", () => ({
  ImporterRunChart: () => null,
}));

import { useDashboardSummary } from "@/api/hooks/dashboard";
import { useComponents } from "@/api/hooks/components";
import { useProducts } from "@/api/hooks/products";

const mockSummary = vi.mocked(useDashboardSummary);
const mockUseComponents = vi.mocked(useComponents);
const mockUseProducts = vi.mocked(useProducts);

const coverage = {
  components: { active: 4, wired: 3, wiredPct: 75 },
  products: { total: 5, missingOwner: 2, missingDependencies: 1, missingDescription: 1 },
};

const summary = {
  counts: {
    products: { total: 5, byType: { PLATFORM: 1 } },
    components: { total: 10, byLifecycle: { ACTIVE: 9, RETIRED: 1 } },
    instances: { total: 3, byStatus: { RUNNING: 3 } },
  },
  lastImportAt: null,
  attention: [],
  lastRuns: [],
  coverage,
};

const componentsResult = {
  data: {
    data: [],
    pagination: { page: 1, pageSize: 50, total: 0, pageCount: 0, hasNext: false },
  },
  isPending: false, isFetching: false, error: null, refetch: vi.fn(),
};

const productsResult = {
  data: { products: [], edges: [] },
  isPending: false, error: null, refetch: vi.fn(),
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderWithRoute(node: React.ReactNode, entry = "/") {
  return render(<MemoryRouter initialEntries={[entry]}>{node}</MemoryRouter>);
}

// ---------- T007: dashboard coverage section ----------

describe("DashboardPage catalog coverage", () => {
  it("renders coverage tiles with counts and worklist links", () => {
    mockSummary.mockReturnValue({ data: summary } as unknown as ReturnType<typeof useDashboardSummary>);
    renderWithRoute(<DashboardPage />);
    expect(screen.getByText("Catalog coverage")).toBeDefined();
    expect(screen.getByText("75%")).toBeDefined();
    expect(screen.getByText("Components wired").closest("a")!.getAttribute("href")).toBe("/components?wired=unwired");
    expect(screen.getByText("Missing owner").closest("a")!.getAttribute("href")).toBe("/products?missing=owner");
    expect(screen.getByText("Missing dependencies").closest("a")!.getAttribute("href")).toBe("/products?missing=dependencies");
    expect(screen.getByText("Missing description").closest("a")!.getAttribute("href")).toBe("/products?missing=description");
  });

  it("renders — when the wired denominator is zero", () => {
    mockSummary.mockReturnValue({
      data: {
        ...summary,
        coverage: { ...coverage, components: { active: 0, wired: 0, wiredPct: null } },
      },
    } as unknown as ReturnType<typeof useDashboardSummary>);
    renderWithRoute(<DashboardPage />);
    expect(screen.getByText("—")).toBeDefined();
    expect(screen.queryByText("%")).toBeNull();
  });

  it("labels sunset attention items distinctly with a Sunset overdue badge", () => {
    mockSummary.mockReturnValue({
      data: {
        ...summary,
        attention: [
          {
            kind: "PRODUCT_ERROR",
            label: "Broken product",
            href: "/products/broken",
            at: "2026-09-08T00:00:00Z",
          },
          {
            kind: "SUNSET_OVERDUE_PRODUCT",
            label: "Old product",
            href: "/products/old",
            at: "2020-01-01T00:00:00Z",
          },
          {
            kind: "SUNSET_OVERDUE_COMPONENT",
            label: "old-comp",
            href: "/components/old-comp",
            at: "2020-01-01T00:00:00Z",
          },
        ],
      },
    } as unknown as ReturnType<typeof useDashboardSummary>);
    renderWithRoute(<DashboardPage />);
    expect(screen.getByText("Product sunset overdue:")).toBeDefined();
    expect(screen.getByText("Component sunset overdue:")).toBeDefined();
    expect(screen.getAllByText("Sunset overdue")).toHaveLength(2);
  });
});

// ---------- T013: URL-driven filter emission ----------

describe("coverage filters", () => {
  it("reads wired=unwired from the URL and emits facet selections back", async () => {
    mockUseComponents.mockReturnValue(componentsResult as unknown as ReturnType<typeof useComponents>);
    renderWithRoute(<ComponentsPage />, "/components?wired=unwired");
    expect(mockUseComponents).toHaveBeenCalledWith(
      expect.objectContaining({ wired: "unwired" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /filter by wiring/i }));
    fireEvent.click(await screen.findByText("Wired"));
    expect(mockUseComponents).toHaveBeenLastCalledWith(
      expect.objectContaining({ wired: "unwired,wired" }),
    );
  });

  it("clear-all empties the wired param", () => {
    mockUseComponents.mockReturnValue(componentsResult as unknown as ReturnType<typeof useComponents>);
    renderWithRoute(<ComponentsPage />, "/components?wired=unwired");
    fireEvent.click(screen.getByRole("button", { name: /clear all/i }));
    const last = mockUseComponents.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    expect(last.wired).toBeUndefined();
  });

  it("reads missing=owner,description from the URL and emits facet selections", async () => {
    mockUseProducts.mockReturnValue(productsResult as unknown as ReturnType<typeof useProducts>);
    renderWithRoute(<ProductsPage />, "/products?missing=owner,description");
    expect(mockUseProducts).toHaveBeenCalledWith(
      expect.objectContaining({ missing: "owner,description" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /filter by completeness/i }));
    fireEvent.click(await screen.findByText("No dependencies"));
    expect(mockUseProducts).toHaveBeenLastCalledWith(
      expect.objectContaining({ missing: "owner,description,dependencies" }),
    );
  });
});

// T024 chip/tree rendering lives in completeness-chip.test.tsx.
