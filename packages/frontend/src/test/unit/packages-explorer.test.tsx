import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import type { ReactNode } from "react";
import { api } from "@/api/client";
import { UxPackagesPage } from "@/ux/app/packages/index";
import { SessionProvider } from "@/ux/components/app/session-context";
import { CommandMenuProvider } from "@/ux/components/app/command-menu";
import { flags } from "@/ux/lib/flags";
import { navVisible, NAV_SECTIONS } from "@/ux/lib/nav";

/**
 * Spec 074 (US1+US2): /packages renders one row per version-free purl,
 * expands to the consumers panel, version chips filter consumers via the
 * `version` param, and empty states distinguish no-inventory vs no-match.
 */

vi.mock("@/api/client", () => ({ api: vi.fn() }));
const mockApi = vi.mocked(api);

const row = (over: Record<string, unknown> = {}) => ({
  purl: "pkg:npm/lodash",
  name: "lodash",
  ecosystem: "npm",
  versionCount: 2,
  versions: [
    { version: "4.17.21", componentCount: 2 },
    { version: "4.17.20", componentCount: 1 },
  ],
  componentCount: 2,
  catalogComponent: null,
  pendingSuggestionCount: 0,
  ...over,
});

const overflowRow = row({
  purl: "pkg:npm/many",
  name: "many",
  versionCount: 7,
  versions: [
    { version: "7.0.0", componentCount: 3 },
    { version: "6.0.0", componentCount: 2 },
    { version: "5.0.0", componentCount: 1 },
    { version: "4.0.0", componentCount: 1 },
    { version: "3.0.0", componentCount: 1 },
  ],
  componentCount: 4,
});

const consumer = (over: Record<string, unknown> = {}) => ({
  component: { id: "c1", slug: "payments-api", name: "payments-api", category: "REPOSITORY" },
  version: "4.17.21",
  scope: "RUNTIME",
  direct: true,
  lastReportedAt: "2026-02-01T00:00:00Z",
  ...over,
});

const page = (rows: unknown[] = [row()]) => ({
  data: rows,
  pagination: { page: 1, pageSize: 25, total: rows.length, pageCount: 1, hasNext: false },
  facets: { ecosystems: ["npm", "deb"] },
});
const consumersPage = (rows: unknown[] = [consumer()]) => ({
  data: rows,
  pagination: { page: 1, pageSize: 25, total: rows.length, pageCount: 1, hasNext: false },
});

function wrap(children: ReactNode, initialEntries = ["/packages"]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries}>
        <TooltipProvider>{children}</TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const consumerUrls = () =>
  mockApi.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("consumers"));

const adminUser = {
  id: "u-admin",
  username: "admin",
  displayName: "Admin",
  email: null,
  role: "ADMIN",
  isActive: true,
  createdAt: "2026-01-01T00:00:00Z",
};

const searchHits = (over: Record<string, unknown> = {}) => ({
  products: [],
  components: [],
  groups: [],
  importers: [],
  lobs: [],
  teams: [],
  packages: [
    {
      id: "pkg:npm/lodash",
      name: "pkg:npm/lodash",
      href: `/packages?q=${encodeURIComponent("pkg:npm/lodash")}`,
    },
  ],
  ...over,
});

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
  (flags as Record<string, boolean>).packagesExplorer = true;
});

describe("UxPackagesPage (spec 074)", () => {
  it("renders the rollup table with subtitle, purl, chips, and no warning tone", async () => {
    wrap(<UxPackagesPage />);
    await screen.findByText("lodash");
    expect(screen.getByText("pkg:npm/lodash")).toBeTruthy();
    expect(screen.getByText("npm")).toBeTruthy();
    expect(screen.getByText(/does not scan for vulnerabilities/)).toBeTruthy();
    expect(screen.getByTestId("version-chip-4.17.21")).toBeTruthy();
    expect(screen.getByText("4.17.21 × 2")).toBeTruthy();
  });

  it("expands a row to the consumers panel linking into the BOM tab", async () => {
    wrap(<UxPackagesPage />);
    const r = await screen.findByTestId("package-row-pkg:npm/lodash");
    fireEvent.click(r);
    expect(await screen.findByText("payments-api")).toBeTruthy();
    const link = screen.getByRole("link", { name: "payments-api" });
    expect(link.getAttribute("href")).toContain("tab=bom");
    expect(decodeURIComponent(link.getAttribute("href")!)).toContain("q=pkg:npm/lodash");
  });

  it("version chip sets ?version= and forwards it to the consumers call", async () => {
    wrap(<UxPackagesPage />);
    await screen.findByText("lodash");
    fireEvent.click(screen.getByTestId("version-chip-4.17.20"));
    await waitFor(() =>
      expect(consumerUrls().some((u) => u.includes("version=4.17.20"))).toBe(true),
    );
  });

  it("search below 2 characters shows a hint and does not call the API with it", async () => {
    wrap(<UxPackagesPage />, ["/packages?q=l"]);
    await screen.findByTestId("packages-search-hint");
    const listUrls = mockApi.mock.calls
      .map((c) => String(c[0]))
      .filter((u) => u.startsWith("/packages"));
    expect(listUrls.every((u) => !u.includes("search="))).toBe(true);
  });

  it("distinguishes no-inventory from no-match empty states", async () => {
    mockApi.mockImplementation(() => Promise.resolve(page([])));
    wrap(<UxPackagesPage />);
    expect(await screen.findByText("No package inventory yet")).toBeTruthy();
    cleanup();
    mockApi.mockReset();
    mockApi.mockImplementation(() => Promise.resolve(page([])));
    wrap(<UxPackagesPage />, ["/packages?q=ghost"]);
    expect(await screen.findByText("No packages match")).toBeTruthy();
  });

  it("shows +N more when versionCount exceeds the top-5 chips", async () => {
    mockApi.mockImplementation(() => Promise.resolve(page([overflowRow])));
    wrap(<UxPackagesPage />);
    await screen.findByText("many");
    expect(screen.getByText("+2 more")).toBeTruthy();
  });

  it("consumers panel shows an inline retry state on fetch failure", async () => {
    mockApi.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes("consumers")) return Promise.reject(new Error("boom"));
      return Promise.resolve(page());
    });
    wrap(<UxPackagesPage />);
    fireEvent.click(await screen.findByTestId("package-row-pkg:npm/lodash"));
    expect(await screen.findByText("Consumers unavailable")).toBeTruthy();
  });

  it("flag off renders zero surface: route redirects, nav item hidden, no fetch", async () => {
    const packagesNav = NAV_SECTIONS.flatMap((s) => s.items).find(
      (i) => i.href === "/packages",
    )!;
    expect(navVisible("VIEWER", packagesNav)).toBe(true);
    (flags as Record<string, boolean>).packagesExplorer = false;
    mockApi.mockClear();
    wrap(
      <Routes>
        <Route path="/packages" element={<UxPackagesPage />} />
        <Route path="/" element={<div>home</div>} />
      </Routes>,
    );
    // SC-005: no route content appears — the page redirects off /packages.
    expect(await screen.findByText("home")).toBeTruthy();
    expect(screen.queryByText("Packages")).toBeNull();
    expect(navVisible("ADMIN", packagesNav)).toBe(false);
    // The flag must stay off through async re-renders — restoring it here
    // would let the session-resolution render enable the query.
    await new Promise((r) => setTimeout(r, 50));
    expect(
      mockApi.mock.calls.some((c) => String(c[0]).startsWith("/packages")),
    ).toBe(false);
  });

  it("Viewer sees no Importers link in the no-inventory empty state", async () => {
    mockApi.mockImplementation(() => Promise.resolve(page([])));
    wrap(<UxPackagesPage />);
    await screen.findByText("No package inventory yet");
    expect(screen.queryByText("Set up an importer")).toBeNull();
  });

  it("Admin sees the Importers link in the no-inventory empty state", async () => {
    mockApi.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u === "/auth/session") return Promise.resolve({ user: adminUser });
      return Promise.resolve(page([]));
    });
    wrap(<UxPackagesPage />);
    await screen.findByText("No package inventory yet");
    const link = await screen.findByRole("link", { name: "Set up an importer" });
    expect(link.getAttribute("href")).toBe("/importers");
  });

  it("sends search, filters, and sort as API params", async () => {
    wrap(<UxPackagesPage />, ["/packages?q=lod&scope=DEV&sort=name&order=asc"]);
    await screen.findByText("lodash");
    const url = mockApi.mock.calls
      .map((c) => String(c[0]))
      .find((u) => u.startsWith("/packages") && u.includes("search=lod"))!;
    expect(url).toContain("scope=DEV");
    expect(url).toContain("sort=name");
    expect(url).toContain("order=asc");
  });
});

describe("Command palette Packages group (spec 074 US3)", () => {
  function LocationProbe() {
    const loc = useLocation();
    return <div data-testid="loc">{loc.pathname + loc.search}</div>;
  }

  const mountPalette = async () => {
    wrap(
      <SessionProvider>
        <CommandMenuProvider>
          <Routes>
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </CommandMenuProvider>
      </SessionProvider>,
    );
    // The provider mounts children only after the session resolves.
    await screen.findByTestId("loc");
    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    return screen.findByPlaceholderText(
      "Search products, components, pages…",
    );
  };

  it("renders the Packages group and navigates to /packages?q= on select", async () => {
    mockApi.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u === "/auth/session") return Promise.resolve({ user: adminUser });
      if (u.startsWith("/search")) return Promise.resolve(searchHits());
      return Promise.resolve(page());
    });
    const input = await mountPalette();
    // Navigate group includes the flagged Packages item while the flag is on.
    expect(screen.getByText("Packages")).toBeTruthy();
    fireEvent.change(input, { target: { value: "lod" } });
    const item = await screen.findByText("pkg:npm/lodash");
    fireEvent.click(item);
    // SearchHit.href is honored — the palette navigates into the explorer.
    await waitFor(() =>
      expect(screen.getByTestId("loc").textContent).toBe(
        `/packages?q=${encodeURIComponent("pkg:npm/lodash")}`,
      ),
    );
  });

  it("hides the Packages group and Navigate entry when the flag is off", async () => {
    mockApi.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u === "/auth/session") return Promise.resolve({ user: adminUser });
      if (u.startsWith("/search"))
        return Promise.resolve(
          searchHits({
            components: [{ id: "c1", name: "billing-svc", slug: "billing-svc" }],
          }),
        );
      return Promise.resolve(page());
    });
    (flags as Record<string, boolean>).packagesExplorer = false;
    const input = await mountPalette();
    expect(screen.queryByText("Packages")).toBeNull();
    fireEvent.change(input, { target: { value: "lod" } });
    // Results resolve (a component hit renders) but no Packages group.
    await screen.findByText("billing-svc");
    expect(screen.queryByText("pkg:npm/lodash")).toBeNull();
  });
});
