import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import type { ReactNode } from "react";
import { api } from "@/api/client";
import { flags } from "@/ux/lib/flags";
import { ProductDetail } from "@/ux/components/products/product-detail";
import { ProductPackagesPanel } from "@/ux/components/products/product-packages";
import type { Product, ProductTopology } from "@/ux/lib/view-types";

/**
 * Spec 080: the product Packages tab — flag-gated tab on product detail,
 * aggregated package rows with the declared signal and coverage line,
 * expand-to-consumers with reachability attribution, and the distinct
 * no-deps / no-data / no-match empty states.
 */

vi.mock("@/api/client", () => ({ api: vi.fn() }));
const mockApi = vi.mocked(api);

const product: Product = {
  id: "p1",
  name: "Shop",
  slug: "shop",
  type: "BUSINESS_CAPABILITY",
  lifecycle: "ACTIVE",
  status: "RUNNING",
  criticality: null,
  description: null,
  lobOwnerName: null,
  teamOwnerName: null,
  tags: [],
  links: [],
  sunsetAt: null,
  componentCount: 0,
  completeness: { owner: true, description: true, dependencies: true },
  updatedAt: "2026-01-01T00:00:00Z",
};

const topology: ProductTopology = {
  composedBy: [],
  composes: [],
  consumesFrom: [],
  consumedBy: [],
  dependsOnGroups: [],
  dependsOnComponents: [],
  unavailableGroups: [],
};

const row = (over: Record<string, unknown> = {}) => ({
  purl: "pkg:npm/lodash",
  name: "lodash",
  ecosystem: "npm",
  versionCount: 2,
  versions: [
    { version: "4.17.21", componentCount: 2 },
    { version: "3.10.1", componentCount: 1 },
  ],
  componentCount: 3,
  catalogComponent: { id: "lib-1", slug: "pkg-npm-lodash", name: "lodash" },
  declared: { kind: "DIRECT" },
  lastReportedAt: new Date().toISOString(),
  ...over,
});

const consumer = (over: Record<string, unknown> = {}) => ({
  component: { id: "c1", slug: "payments-api", name: "payments-api", category: "REPOSITORY" },
  depSource: { kind: "INHERITED", product: { id: "p-core", slug: "core", name: "Core" } },
  version: "4.17.21",
  scope: "RUNTIME",
  direct: true,
  lastReportedAt: "2026-02-01T00:00:00Z",
  ...over,
});

const page = (
  rows: unknown[] = [row()],
  coverage = { reporting: 3, total: 4, reachable: 7 },
) => ({
  data: rows,
  pagination: { page: 1, pageSize: 25, total: rows.length, pageCount: 1, hasNext: false },
  coverage,
  staleThresholdDays: 7,
  facets: { ecosystems: ["npm"] },
});

const consumersPage = (rows: unknown[] = [consumer()]) => ({
  data: rows,
  pagination: { page: 1, pageSize: 25, total: rows.length, pageCount: 1, hasNext: false },
});

function wrap(children: ReactNode, initialEntries = ["/products/shop?tab=packages"]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries}>
        <TooltipProvider>{children}</TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const packageCalls = () =>
  mockApi.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/packages"));

beforeEach(() => {
  mockApi.mockReset();
  mockApi.mockImplementation((url: unknown) => {
    const u = String(url);
    if (u.includes("consumers")) return Promise.resolve(consumersPage());
    if (u.includes("/packages")) return Promise.resolve(page());
    return Promise.resolve(null);
  });
});

afterEach(() => {
  cleanup();
  (flags as Record<string, boolean>).productPackageRollup = true;
});

describe("Product Packages tab (spec 080)", () => {
  it("renders the Packages tab trigger when the flag is ON, hidden when OFF", async () => {
    wrap(
      <ProductDetail
        product={product}
        components={[]}
        consumers={[]}
        parents={[]}
        topology={topology}
        suggestions={[]}
        activity={[]}
      />,
    );
    expect(screen.getByRole("tab", { name: "Packages" })).toBeTruthy();
    cleanup();

    (flags as Record<string, boolean>).productPackageRollup = false;
    mockApi.mockClear();
    wrap(
      <ProductDetail
        product={product}
        components={[]}
        consumers={[]}
        parents={[]}
        topology={topology}
        suggestions={[]}
        activity={[]}
      />,
    );
    expect(screen.queryByRole("tab", { name: "Packages" })).toBeNull();
    await new Promise((r) => setTimeout(r, 50));
    expect(packageCalls()).toHaveLength(0);
  });

  it("renders rows with declared marker, coverage line, and D8 subtitle", async () => {
    wrap(<ProductPackagesPanel slug="shop" />);
    await screen.findByText("lodash");
    expect(screen.getByText("pkg:npm/lodash")).toBeTruthy();
    expect(
      screen.getByTestId("product-packages-coverage").textContent,
    ).toContain("3 of 4 reporting");
    expect(screen.getByText(/does not scan for vulnerabilities/)).toBeTruthy();
    expect(screen.getByText("Direct edge")).toBeTruthy();
    expect(screen.getByText("4.17.21 × 2")).toBeTruthy();
  });

  it("renders toolbar, filters, and sort control", async () => {
    wrap(<ProductPackagesPanel slug="shop" />);
    await screen.findByText("lodash");
    expect(
      screen.getByPlaceholderText("Search packages by name or purl"),
    ).toBeTruthy();
    expect(screen.getByText("Ecosystem")).toBeTruthy();
    expect(screen.getByText("Declared")).toBeTruthy();
  });

  it("shows the ≥2-char search hint without sending the sub-length search", async () => {
    wrap(<ProductPackagesPanel slug="shop" />, ["/products/shop?tab=packages&q=l"]);
    await screen.findByTestId("product-packages-search-hint");
    expect(
      packageCalls().every((u) => !u.includes("search=")),
    ).toBe(true);
  });

  it("distinguishes no-deps, no-data, and no-match empty states", async () => {
    mockApi.mockImplementation(() =>
      Promise.resolve(page([], { reporting: 0, total: 0, reachable: 0 })),
    );
    wrap(<ProductPackagesPanel slug="shop" />);
    expect(await screen.findByText("No component dependencies")).toBeTruthy();
    cleanup();

    mockApi.mockImplementation(() =>
      Promise.resolve(page([], { reporting: 0, total: 4, reachable: 4 })),
    );
    wrap(<ProductPackagesPanel slug="shop" />);
    expect(await screen.findByText("No package data reported")).toBeTruthy();
    cleanup();

    // Reachable set is library-only: the product HAS dependencies, they
    // just report nothing — must not show "No component dependencies".
    mockApi.mockImplementation(() =>
      Promise.resolve(page([], { reporting: 0, total: 0, reachable: 2 })),
    );
    wrap(<ProductPackagesPanel slug="shop" />);
    expect(await screen.findByText("No package data reported")).toBeTruthy();
    cleanup();

    mockApi.mockImplementation(() =>
      Promise.resolve(page([], { reporting: 3, total: 4, reachable: 7 })),
    );
    wrap(<ProductPackagesPanel slug="shop" />, ["/products/shop?tab=packages&q=ghost"]);
    expect(await screen.findByText("No packages match")).toBeTruthy();
  });

  it("marks stale rows from lastReportedAt vs staleThresholdDays", async () => {
    mockApi.mockImplementation(() =>
      Promise.resolve(
        page([row({ lastReportedAt: "2020-01-01T00:00:00Z" })]),
      ),
    );
    wrap(<ProductPackagesPanel slug="shop" />);
    await screen.findByText("lodash");
    expect(screen.getByTestId("stale-pkg:npm/lodash")).toBeTruthy();
  });

  it("expands a row to consumers with reachability attribution and BOM deep link", async () => {
    wrap(<ProductPackagesPanel slug="shop" />);
    fireEvent.click(await screen.findByTestId("product-package-row-pkg:npm/lodash"));
    expect(await screen.findByText("payments-api")).toBeTruthy();
    expect(screen.getByText("Inherited · Core")).toBeTruthy();
    const link = screen.getByRole("link", { name: "payments-api" });
    expect(link.getAttribute("href")).toContain("tab=bom");
    expect(decodeURIComponent(link.getAttribute("href")!)).toContain(
      "q=pkg:npm/lodash",
    );
  });

  it("version chip narrows the consumers call via ?version=", async () => {
    wrap(<ProductPackagesPanel slug="shop" />);
    await screen.findByText("lodash");
    fireEvent.click(screen.getByTestId("version-chip-3.10.1"));
    await waitFor(() =>
      expect(
        mockApi.mock.calls
          .map((c) => String(c[0]))
          .some((u) => u.includes("consumers") && u.includes("version=3.10.1")),
      ).toBe(true),
    );
  });
});
