import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import type { ReactNode } from "react";
import { api } from "@/api/client";
import { ComponentBomTab } from "@/ux/components/catalog/component-bom";
import { ComponentDetail } from "@/ux/components/catalog/component-detail";
import { flags } from "@/ux/lib/flags";
import type { Component } from "@/ux/lib/view-types";

/**
 * Spec 073 (UX-BOM-01…11): the component BOM tab is read-only and
 * URL-driven, the instance picker only appears with 2+ instances, and the
 * Flat/Tree toggle only appears when nesting exists. The flag gates the
 * whole tab — hidden, not disabled.
 */

vi.mock("@/api/client", () => ({ api: vi.fn() }));
const mockApi = vi.mocked(api);

const component: Component = {
  id: "comp-1",
  name: "payments-api",
  slug: "payments-api",
  category: "REPOSITORY",
  provider: "GITHUB",
  resourceType: "github:repository",
  lifecycle: "ACTIVE",
  componentGroups: [],
  teamOwnerId: null,
  teamOwnerName: null,
  tags: [],
  sunsetAt: null,
  links: [],
  instanceCount: 2,
  instances: [],
  lastSeenAt: "2026-01-10T00:00:00Z",
  worstStatus: null,
  details: null,
};

const entry = (over: Record<string, unknown> = {}) => ({
  id: "be-1",
  purl: "pkg:npm/lodash@4.17.21",
  name: "lodash",
  version: "4.17.21",
  ecosystem: "npm",
  scope: "RUNTIME",
  direct: true,
  evidenceSource: "LOCK_FILE",
  evidenceDetail: "package-lock.json",
  licenses: ["MIT"],
  supplier: null,
  cdxType: "library",
  source: { id: "src-1", name: "GitHub prod" },
  lastReportedAt: "2026-01-10T00:00:00Z",
  parentId: null,
  parentName: null,
  hasChildren: false,
  childCount: 0,
  instanceCount: 2,
  instanceTotal: 2,
  resolvedComponent: null,
  pendingSuggestionId: null,
  ...over,
});

const summary = (over: Record<string, unknown> = {}) => ({
  total: 1,
  direct: 1,
  ecosystems: ["npm"],
  licenseCount: 1,
  hasNesting: false,
  lastReportedAt: "2026-01-10T00:00:00Z",
  staleThresholdDays: 7,
  sources: [
    { id: "src-1", name: "GitHub prod", importerKind: "github", lastReportedAt: "2026-01-10T00:00:00Z" },
  ],
  instances: [
    { id: "inst-1", name: "prod", environment: "PRODUCTION", entryCount: 1 },
    { id: "inst-2", name: "dev", environment: "DEV", entryCount: 1 },
  ],
  ...over,
});

const page = (rows = [entry()]) => ({
  data: rows,
  pagination: {
    page: 1,
    pageSize: 25,
    total: rows.length,
    pageCount: 1,
    hasNext: false,
  },
});

function wrap(children: ReactNode, initialEntries = ["/components/payments-api"]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={initialEntries}>
        <TooltipProvider>{children}</TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const apiUrls = () => mockApi.mock.calls.map((c) => String(c[0]));
const bomListUrls = () =>
  apiUrls().filter((u) => u.includes("/bom") && !u.includes("/summary"));

beforeEach(() => {
  mockApi.mockReset();
  mockApi.mockImplementation((url: unknown) => {
    const u = String(url);
    if (u.includes("/bom/summary")) return Promise.resolve(summary());
    if (u.includes("/bom")) return Promise.resolve(page());
    return Promise.resolve(null);
  });
});

afterEach(() => {
  cleanup();
  (flags as Record<string, boolean>).componentBom = true;
  (flags as Record<string, boolean>).packagesExplorer = true;
});

describe("ComponentBomTab (spec 073)", () => {
  it("renders the summary strip, rows, and the inventory-only disclaimer — no advisories", async () => {
    wrap(<ComponentBomTab component={component} />);
    await screen.findByText("lodash");
    expect(screen.getByText("Packages")).toBeTruthy();
    expect(screen.getByText("Direct")).toBeTruthy();
    expect(screen.getByText("Ecosystems")).toBeTruthy();
    expect(screen.getAllByText("Licenses").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Last reported")).toBeTruthy();
    expect(
      screen.getByText(/Inventory only\. Componode does not scan for vulnerabilities\./),
    ).toBeTruthy();
    // No advisories column — not even a disabled one (UX-BOM-16).
    expect(screen.queryByText(/vulnerabilit|advisor/i)?.tagName).not.toBe("TH");
  });

  it("round-trips URL state into the API query (scope + depth → direct)", async () => {
    wrap(<ComponentBomTab component={component} />, [
      "/components/payments-api?scope=DEV&depth=direct",
    ]);
    await screen.findByText("lodash");
    const last = bomListUrls().at(-1) ?? "";
    expect(last).toContain("scope=DEV");
    expect(last).toContain("direct=true");
  });

  it("resets to page 1 when a filter changes", async () => {
    wrap(<ComponentBomTab component={component} />, [
      "/components/payments-api?page=2",
    ]);
    await screen.findByText("lodash");
    expect(bomListUrls().at(-1)).toContain("page=2");
    fireEvent.change(screen.getByLabelText("Search packages…"), {
      target: { value: "lodash" },
    });
    await waitFor(() => {
      const last = bomListUrls().at(-1) ?? "";
      expect(last).toContain("search=lodash");
      expect(last).not.toContain("page=2");
    });
  });

  it("shows the instance picker only with two or more instances", async () => {
    wrap(<ComponentBomTab component={component} />);
    await screen.findByText("lodash");
    expect(screen.getByLabelText("Instance")).toBeTruthy();
    cleanup();
    mockApi.mockReset();
    mockApi.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes("/bom/summary"))
        return Promise.resolve(summary({ instances: [summary().instances[0]] }));
      if (u.includes("/bom")) return Promise.resolve(page());
      return Promise.resolve(null);
    });
    wrap(<ComponentBomTab component={component} />);
    await screen.findByText("lodash");
    await waitFor(() => expect(screen.queryByLabelText("Instance")).toBeNull());
  });

  it("shows the Flat/Tree toggle only when nesting exists, and requests view=tree", async () => {
    // Flat summary — no toggle.
    wrap(<ComponentBomTab component={component} />);
    await screen.findByText("lodash");
    await waitFor(() => expect(screen.queryByLabelText("Tree view")).toBeNull());
    cleanup();
    mockApi.mockReset();
    mockApi.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes("/bom/summary"))
        return Promise.resolve(summary({ hasNesting: true }));
      if (u.includes("/bom"))
        return Promise.resolve(
          page([entry({ hasChildren: true, childCount: 2 })]),
        );
      return Promise.resolve(null);
    });
    wrap(<ComponentBomTab component={component} />);
    await screen.findByText("lodash");
    fireEvent.click(await screen.findByLabelText("Tree view"));
    await waitFor(() =>
      expect(bomListUrls().at(-1)).toContain("view=tree"),
    );
  });

  it("renders the honest empty state with the disclaimer hidden", async () => {
    mockApi.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes("/bom/summary")) return Promise.resolve(summary({ total: 0 }));
      if (u.includes("/bom")) return Promise.resolve(page([]));
      return Promise.resolve(null);
    });
    wrap(<ComponentBomTab component={component} />);
    await screen.findByText("No bill of materials reported");
  });

  it("row menu links 'See where it's used' only when packagesExplorer is on", async () => {
    wrap(<ComponentBomTab component={component} />);
    await screen.findByText("lodash");
    fireEvent.keyDown(screen.getByLabelText("Actions for lodash"), {
      key: "ArrowDown",
    });
    const link = await screen.findByText("See where it's used");
    expect(link.closest("a")?.getAttribute("href")).toContain(
      `/packages?q=${encodeURIComponent("pkg:npm/lodash@4.17.21")}`,
    );
    cleanup();
    (flags as Record<string, boolean>).packagesExplorer = false;
    wrap(<ComponentBomTab component={component} />);
    await screen.findByText("lodash");
    fireEvent.keyDown(screen.getByLabelText("Actions for lodash"), {
      key: "ArrowDown",
    });
    await screen.findByText("Copy purl");
    expect(screen.queryByText("See where it's used")).toBeNull();
  });
});

describe("ComponentDetail BOM tab (spec 073)", () => {
  it("shows the Packages tab with a count when the flag is on, and hides it when off", async () => {
    wrap(<ComponentDetail component={component} />);
    expect(await screen.findByRole("tab", { name: /Packages/i })).toBeTruthy();
    cleanup();
    (flags as Record<string, boolean>).componentBom = false;
    wrap(<ComponentDetail component={component} />);
    await screen.findByRole("tab", { name: /Overview/i });
    expect(screen.queryByRole("tab", { name: /Packages/i })).toBeNull();
  });
});
