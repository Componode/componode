import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import type { ReactNode } from "react";
import { api } from "@/api/client";
import { ComponentBomTab } from "@/ux/components/catalog/component-bom";
import type { Component } from "@/ux/lib/view-types";

/**
 * Spec 073 (UX-FRESH-01…04): stale threshold styling with the "No import
 * run has reported…" tooltip, the multi-source *Last reported* popover, and
 * per-row Source attribution on hover.
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
  instanceCount: 1,
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
  instanceCount: 0,
  instanceTotal: 0,
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
  instances: [{ id: "inst-1", name: "prod", environment: "PRODUCTION", entryCount: 1 }],
  ...over,
});

const page = (rows = [entry()]) => ({
  data: rows,
  pagination: { page: 1, pageSize: 25, total: rows.length, pageCount: 1, hasNext: false },
});

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TooltipProvider>{children}</TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const stubApi = (s: Record<string, unknown> = {}, rows = [entry()]) => {
  mockApi.mockReset();
  mockApi.mockImplementation((url: unknown) => {
    const u = String(url);
    if (u.includes("/bom/summary")) return Promise.resolve(summary(s));
    if (u.includes("/bom")) return Promise.resolve(page(rows));
    return Promise.resolve(null);
  });
};

beforeEach(() => stubApi());
afterEach(cleanup);

const lastReportedEl = async <T extends Element = HTMLElement>() => {
  const dt = await screen.findByText("Last reported");
  return dt.parentElement!.querySelector("dd a, dd button") as T;
};

describe("BOM freshness (spec 073 UX-FRESH)", () => {
  it("warns when the newest report is older than the stale threshold", async () => {
    stubApi({ lastReportedAt: "2000-01-01T00:00:00Z" });
    wrap(<ComponentBomTab component={component} />);
    const link = await lastReportedEl<HTMLAnchorElement>();
    expect(link.className).toContain("text-warning");
    fireEvent.focus(link);
    await screen.findByText(/No import run has reported this inventory since/);
  });

  it("keeps normal styling inside the threshold", async () => {
    stubApi({ lastReportedAt: new Date().toISOString() });
    wrap(<ComponentBomTab component={component} />);
    const link = await lastReportedEl<HTMLAnchorElement>();
    expect(link.className).not.toContain("text-warning");
    expect(link.title ?? "").not.toMatch(/No import run has reported/);
  });

  it("lists every Source in a popover when more than one reported", async () => {
    stubApi({
      sources: [
        { id: "src-1", name: "GitHub prod", importerKind: "github", lastReportedAt: "2026-01-10T00:00:00Z" },
        { id: "src-2", name: "Docker registry", importerKind: "docker", lastReportedAt: "2026-01-11T00:00:00Z" },
      ],
      lastReportedAt: "2026-01-11T00:00:00Z",
    });
    wrap(<ComponentBomTab component={component} />);
    const trigger = await lastReportedEl<HTMLButtonElement>();
    fireEvent.click(trigger);
    await waitFor(() => {
      expect(screen.getByRole("link", { name: "GitHub prod" })).toBeTruthy();
      expect(screen.getByRole("link", { name: "Docker registry" })).toBeTruthy();
    });
  });

  it("names the reporting Source on row hover", async () => {
    wrap(<ComponentBomTab component={component} />);
    const name = await screen.findByText("lodash");
    expect(name.title).toContain("Reported by GitHub prod");
  });
});
