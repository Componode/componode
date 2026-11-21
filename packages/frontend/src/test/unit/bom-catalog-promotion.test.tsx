import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import type { ReactNode } from "react";
import { api } from "@/api/client";
import { BomAddToCatalogDialog } from "@/ux/components/catalog/bom-add-to-catalog-dialog";
import { ComponentBomTab } from "@/ux/components/catalog/component-bom";
import { ComponentRelationships } from "@/ux/components/catalog/component-relationships";
import {
  DependencyDecidedList,
  DependencyGroupsPanel,
} from "@/ux/components/catalog/dependency-suggestion-groups";
import { UxComponentsPage } from "@/ux/app/components/index";
import { UxSuggestionsPage } from "@/ux/app/suggestions";
import { LibraryPackageCard } from "@/ux/components/catalog/package-details";
import { flags } from "@/ux/lib/flags";
import type { Component, ComponentRelationshipsView } from "@/ux/lib/view-types";

/**
 * Spec 075 — consolidated frontend coverage for BOM catalog promotion:
 * the Add/Link dialog modes + copy, the BOM In-catalog cells, the
 * dependency-suggestion groups segment, the Show-libraries toggle, and
 * the Relationships libraries summary node.
 */

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return { ...actual, api: vi.fn() };
});
const mockApi = vi.mocked(api);

const editorUser = (role = "EDITOR") => ({
  user: {
    id: "u-1",
    username: "curator",
    displayName: "Curator",
    email: null,
    role,
    isActive: true,
    createdAt: "2026-01-01T00:00:00Z",
  },
});

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

const bomEntry = (over: Record<string, unknown> = {}) => ({
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

const bomSummary = () => ({
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
});

const page = <T,>(rows: T[]) => ({
  data: rows,
  pagination: { page: 1, pageSize: 25, total: rows.length, pageCount: 1, hasNext: false },
});

const previewAdd = (over: Record<string, unknown> = {}) => ({
  name: "lodash",
  identity: "pkg:npm/lodash",
  category: "LIBRARY",
  provider: "NPM",
  providerGroup: "package-registries",
  resourceType: "npm:package",
  consumerCount: 9,
  versions: [{ version: "4.17.21", componentCount: 9 }],
  mappedFrom: null,
  existingComponent: null,
  ...over,
});

const groupExact = {
  childComponent: { id: "lib-1", slug: "pkg-npm-lodash", name: "lodash", category: "LIBRARY" },
  purl: "pkg:npm/lodash",
  pendingCount: 3,
  versions: 2,
  reasons: ["PURL_EXACT"],
  topScore: 1.0,
  bulkAcceptable: true,
};
const groupNameMatch = {
  childComponent: { id: "lib-2", slug: "pkg-npm-react", name: "react", category: "LIBRARY" },
  purl: "pkg:npm/react",
  pendingCount: 2,
  versions: 1,
  reasons: ["PURL_NAME_MATCH"],
  topScore: 0.5,
  bulkAcceptable: false,
};

const depItem = (id: string, parentSlug: string, child = groupExact.childComponent) => ({
  id,
  parentComponentId: `p-${parentSlug}`,
  childComponentId: child.id,
  bomEntryId: `be-${id}`,
  reason: "PURL_EXACT",
  score: 1.0,
  status: "PENDING",
  createdAt: "2026-01-01T00:00:00Z",
  decidedAt: null,
  decidedBy: null,
  decidedByName: null,
  parentComponent: { id: `p-${parentSlug}`, slug: parentSlug, name: parentSlug, category: "SERVICE" },
  childComponent: child,
});

function wrap(children: ReactNode, initialEntries = ["/"]) {
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
const componentListUrls = () =>
  apiUrls().filter((u) => u.startsWith("/components?") || u === "/components");

beforeEach(() => {
  mockApi.mockReset();
  mockApi.mockImplementation((url: unknown) => {
    const u = String(url);
    if (u.includes("/auth/session")) return Promise.resolve(editorUser());
    if (u.includes("/bom/summary")) return Promise.resolve(bomSummary());
    if (u.includes("/bom")) return Promise.resolve(page([bomEntry()]));
    if (u.includes("/packages/add-to-catalog/preview"))
      return Promise.resolve(previewAdd());
    if (u.includes("/suggestions/dependencies/groups"))
      return Promise.resolve(page([groupExact, groupNameMatch]));
    if (u.includes("/suggestions")) {
      const all = [
        depItem("d1", "orders-api"),
        depItem("d2", "billing-api"),
        depItem("d3", "web-app"),
        depItem("d4", "checkout-web", groupNameMatch.childComponent),
      ];
      // Honor the childComponentId filter like the real endpoint.
      const child = new URL(u, "http://x").searchParams.get(
        "childComponentId",
      );
      return Promise.resolve(
        page(child ? all.filter((i) => i.childComponentId === child) : all),
      );
    }
    if (u === "/components" || u.startsWith("/components?"))
      return Promise.resolve({ ...page([]), librariesHidden: 3 });
    return Promise.resolve(null);
  });
});

afterEach(() => {
  cleanup();
  (flags as Record<string, boolean>).bomCuration = true;
  (flags as Record<string, boolean>).componentBom = true;
  (flags as Record<string, boolean>).packagesExplorer = true;
});

describe("BomAddToCatalogDialog — add mode (spec 075 UX-ADD)", () => {
  const renderDialog = (props: Partial<Parameters<typeof BomAddToCatalogDialog>[0]> = {}) =>
    wrap(
      <BomAddToCatalogDialog
        purl="pkg:npm/lodash@4.17.21"
        open
        onOpenChange={vi.fn()}
        {...props}
      />,
    );

  it("renders the verbatim title + description and preview fields", async () => {
    renderDialog();
    await screen.findByText("Add lodash to the catalog");
    expect(
      screen.getByText(
        (_, el) =>
          el?.textContent ===
          "Creates one Library component that every component using lodash can depend on. Versions stay on each component's own bill of materials.",
      ),
    ).toBeTruthy();
    expect(screen.getByText("Library")).toBeTruthy();
    expect(screen.getByText(/npm · Package registries/)).toBeTruthy();
    expect(screen.getByText("pkg:npm/lodash")).toBeTruthy();
    const usedBy = screen.getByText("Used by 9 components").closest("a");
    expect(usedBy?.getAttribute("href")).toBe(
      `/packages?q=${encodeURIComponent("pkg:npm/lodash")}`,
    );
    expect(screen.getByText("4.17.21 × 9")).toBeTruthy();
  });

  it("carries the consumer count in the primary label and switches on the radio outcome", async () => {
    renderDialog();
    await screen.findByText("Add lodash to the catalog");
    const primary = await screen.findByTestId("bom-curation-submit");
    expect(primary.textContent).toBe("Add and link 9 components");
    expect(
      screen.getByText("Creates dependency edges for every component reporting this package — one atomic change."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Only add to catalog" }));
    expect(screen.getByTestId("bom-curation-submit").textContent).toBe("Add to catalog");
    expect(
      screen.getByText("Stages a suggestion per consumer — a human still decides each edge."),
    ).toBeTruthy();
  });

  it("renders the mappedFrom note on a lossy mapping", async () => {
    mockApi.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes("/auth/session")) return Promise.resolve(editorUser());
      if (u.includes("/packages/add-to-catalog/preview"))
        return Promise.resolve(previewAdd({ mappedFrom: { cdxType: "firmware", ecosystem: "deb" } }));
      return Promise.resolve(null);
    });
    renderDialog();
    await screen.findByText("Add lodash to the catalog");
    expect(
      screen.getByText("Mapped from CycloneDX type firmware / ecosystem deb"),
    ).toBeTruthy();
  });

  it("posts linkConsumers and reports inline failure with Retry — nothing is created", async () => {
    let calls = 0;
    mockApi.mockImplementation((url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/auth/session")) return Promise.resolve(editorUser());
      if (u.includes("/packages/add-to-catalog/preview"))
        return Promise.resolve(previewAdd());
      if (u === "/packages/add-to-catalog" && init?.method === "POST") {
        calls += 1;
        return Promise.reject({ code: "INTERNAL", message: "write failed" });
      }
      return Promise.resolve(null);
    });
    renderDialog();
    await screen.findByText("Add lodash to the catalog");
    fireEvent.click(await screen.findByTestId("bom-curation-submit"));
    await screen.findByText("write failed");
    expect(calls).toBe(1);
    expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
  });

  it("toasts and calls onDone on success", async () => {
    const onDone = vi.fn();
    const onOpenChange = vi.fn();
    mockApi.mockImplementation((url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/auth/session")) return Promise.resolve(editorUser());
      if (u.includes("/packages/add-to-catalog/preview"))
        return Promise.resolve(previewAdd());
      if (u === "/packages/add-to-catalog" && init?.method === "POST")
        return Promise.resolve({
          component: {
            id: "c-new",
            slug: "pkg-npm-lodash",
            name: "lodash",
            category: "LIBRARY",
            provider: "NPM",
            externalId: "pkg:npm/lodash",
          },
          linked: 9,
          alreadyLinked: 0,
          suggestionsStaged: 0,
        });
      return Promise.resolve(null);
    });
    renderDialog({ onDone, onOpenChange });
    await screen.findByText("Add lodash to the catalog");
    fireEvent.click(await screen.findByTestId("bom-curation-submit"));
    await waitFor(() => {
      expect(onDone).toHaveBeenCalled();
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });
});

describe("BomAddToCatalogDialog — link mode (spec 075 US2)", () => {
  beforeEach(() => {
    mockApi.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes("/auth/session")) return Promise.resolve(editorUser());
      if (u.includes("/packages/add-to-catalog/preview"))
        return Promise.resolve(
          previewAdd({
            existingComponent: {
              id: "c-9",
              slug: "shared-lodash",
              name: "Shared lodash",
              category: "LIBRARY",
              provider: "NPM",
            },
          }),
        );
      return Promise.resolve(null);
    });
  });

  it("shows the matched component and Link labels — never a create", async () => {
    wrap(
      <BomAddToCatalogDialog
        purl="pkg:npm/lodash@4.17.21"
        open
        onOpenChange={vi.fn()}
      />,
    );
    await screen.findByText("Link lodash to Shared lodash");
    const matched = screen.getByText("Shared lodash").closest("a");
    expect(matched?.getAttribute("href")).toBe("/components/shared-lodash");
    expect(screen.getByTestId("bom-curation-submit").textContent).toBe(
      "Link all 9 components",
    );
    fireEvent.click(
      screen.getByRole("radio", { name: "Link and stage suggestions" }),
    );
    expect(screen.getByTestId("bom-curation-submit").textContent).toBe("Link");
    expect(screen.queryByText("Add lodash to the catalog")).toBeNull();
  });

  it("posts /packages/link with the matched componentId", async () => {
    const bodies: string[] = [];
    mockApi.mockImplementation((url: unknown, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/auth/session")) return Promise.resolve(editorUser());
      if (u.includes("/packages/add-to-catalog/preview"))
        return Promise.resolve(
          previewAdd({
            existingComponent: {
              id: "c-9",
              slug: "shared-lodash",
              name: "Shared lodash",
              category: "LIBRARY",
              provider: "NPM",
            },
          }),
        );
      if (u === "/packages/link" && init?.method === "POST") {
        bodies.push(String(init.body));
        return Promise.resolve({
          component: {
            id: "c-9",
            slug: "shared-lodash",
            name: "Shared lodash",
            category: "LIBRARY",
            provider: "NPM",
            externalId: "pkg:npm/lodash",
          },
          linked: 9,
          alreadyLinked: 0,
          suggestionsStaged: 0,
        });
      }
      return Promise.resolve(null);
    });
    wrap(
      <BomAddToCatalogDialog
        purl="pkg:npm/lodash@4.17.21"
        open
        onOpenChange={vi.fn()}
      />,
    );
    await screen.findByText("Link lodash to Shared lodash");
    fireEvent.click(await screen.findByTestId("bom-curation-submit"));
    await waitFor(() => expect(bodies.length).toBe(1));
    expect(JSON.parse(bodies[0] as string)).toMatchObject({
      purl: "pkg:npm/lodash@4.17.21",
      componentId: "c-9",
      linkConsumers: true,
    });
  });
});

describe("BOM tab — Add-to-catalog entry point (spec 075 T019)", () => {
  const openMenu = async () => {
    await screen.findByText("lodash");
    fireEvent.keyDown(screen.getByLabelText("Actions for lodash"), { key: "ArrowDown" });
  };

  it("offers Add to catalog to an Editor when the row is unresolved", async () => {
    wrap(<ComponentBomTab component={component} />);
    await openMenu();
    expect(await screen.findByText("Add to catalog")).toBeTruthy();
  });

  it("hides it for a Viewer, under flag-off, and on resolved/suggested rows", async () => {
    // Viewer session → hidden.
    mockApi.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes("/auth/session")) return Promise.resolve(editorUser("VIEWER"));
      if (u.includes("/bom/summary")) return Promise.resolve(bomSummary());
      if (u.includes("/bom")) return Promise.resolve(page([bomEntry()]));
      return Promise.resolve(null);
    });
    wrap(<ComponentBomTab component={component} />);
    await openMenu();
    await screen.findByText("Copy purl");
    expect(screen.queryByText("Add to catalog")).toBeNull();
    cleanup();

    // Flag off → hidden.
    mockApi.mockReset();
    (flags as Record<string, boolean>).bomCuration = false;
    mockApi.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes("/auth/session")) return Promise.resolve(editorUser());
      if (u.includes("/bom/summary")) return Promise.resolve(bomSummary());
      if (u.includes("/bom")) return Promise.resolve(page([bomEntry()]));
      return Promise.resolve(null);
    });
    wrap(<ComponentBomTab component={component} />);
    await openMenu();
    await screen.findByText("Copy purl");
    expect(screen.queryByText("Add to catalog")).toBeNull();
    cleanup();
    (flags as Record<string, boolean>).bomCuration = true;

    // Resolved component → hidden.
    mockApi.mockReset();
    mockApi.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes("/auth/session")) return Promise.resolve(editorUser());
      if (u.includes("/bom/summary")) return Promise.resolve(bomSummary());
      if (u.includes("/bom"))
        return Promise.resolve(
          page([bomEntry({ resolvedComponent: { id: "c-9", slug: "shared", name: "Shared" } })]),
        );
      return Promise.resolve(null);
    });
    wrap(<ComponentBomTab component={component} />);
    await openMenu();
    await screen.findByText("Copy purl");
    expect(screen.queryByText("Add to catalog")).toBeNull();
  });
});

describe("BOM tab — In catalog column (spec 075 T032)", () => {
  it("renders Linked / Suggested / empty per row state", async () => {
    mockApi.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes("/auth/session")) return Promise.resolve(editorUser());
      if (u.includes("/bom/summary")) return Promise.resolve(bomSummary());
      if (u.includes("/bom"))
        return Promise.resolve(
          page([
            bomEntry({
              id: "be-1",
              name: "linked-pkg",
              resolvedComponent: { id: "c-9", slug: "shared", name: "Shared" },
            }),
            bomEntry({ id: "be-2", name: "suggested-pkg", pendingSuggestionId: "sug-1" }),
            bomEntry({ id: "be-3", name: "plain-pkg" }),
          ]),
        );
      return Promise.resolve(null);
    });
    wrap(<ComponentBomTab component={component} />);
    await screen.findByText("linked-pkg");
    const linked = screen.getByText("Linked").closest("a");
    expect(linked?.getAttribute("href")).toBe("/components/shared");
    const suggested = screen.getByText("Suggested").closest("a");
    expect(suggested?.getAttribute("href")).toBe("/suggestions?kind=dependency");
    expect(screen.getByText("plain-pkg")).toBeTruthy();
  });

  it("omits the column entirely when the flag is off", async () => {
    (flags as Record<string, boolean>).bomCuration = false;
    wrap(<ComponentBomTab component={component} />);
    await screen.findByText("lodash");
    expect(screen.queryByText("In catalog")).toBeNull();
  });
});

describe("Dependency suggestion groups (spec 075 US4)", () => {
  const panelProps = {
    page: 1,
    pageSize: 25,
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
  };

  it("renders group headers, reasons, versions, purl and bulk actions", async () => {
    wrap(<DependencyGroupsPanel {...panelProps} />);
    await screen.findByText("lodash");
    expect(screen.getByText("is used by 3 components")).toBeTruthy();
    expect(screen.getByText("is used by 2 components")).toBeTruthy();
    expect(screen.getByText("Exact package match")).toBeTruthy();
    expect(screen.getByText("Name match")).toBeTruthy();
    expect(screen.getByText("2 versions")).toBeTruthy();
    expect(screen.getByText("pkg:npm/lodash")).toBeTruthy();
    // bulkAcceptable → Accept all; name-match group → hidden + explanation.
    expect(screen.getByRole("button", { name: "Accept all 3" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Accept all 2" })).toBeNull();
    expect(
      screen.getByText("Accept all requires exact package matches — review name/slug matches one by one."),
    ).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /Dismiss all/ }).length).toBe(2);
  });

  it("confirms bulk accept with the exact count and finality copy", async () => {
    wrap(<DependencyGroupsPanel {...panelProps} />);
    fireEvent.click(await screen.findByRole("button", { name: "Accept all 3" }));
    await screen.findByText("Accept all 3 suggestions");
    expect(
      screen.getByText(/This is permanent — decided suggestions never come back\./),
    ).toBeTruthy();
  });

  it("expands to per-parent rows with per-row Accept/Dismiss", async () => {
    wrap(<DependencyGroupsPanel {...panelProps} />);
    await screen.findByText("lodash");
    fireEvent.click(screen.getByLabelText("Expand lodash"));
    await screen.findByText("orders-api");
    expect(screen.getByText("billing-api")).toBeTruthy();
    expect(screen.getByText("web-app")).toBeTruthy();
    // Three pending parents under the lodash group (the react group is
    // still collapsed — its row is not rendered).
    expect(screen.getAllByRole("button", { name: "Accept" }).length).toBe(3);
    expect(screen.getAllByRole("button", { name: "Dismiss" }).length).toBe(3);
  });

  it("hides every write control for a Viewer", async () => {
    mockApi.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes("/auth/session")) return Promise.resolve(editorUser("VIEWER"));
      if (u.includes("/suggestions/dependencies/groups"))
        return Promise.resolve(page([groupExact]));
      if (u.includes("/suggestions"))
        return Promise.resolve(page([depItem("d1", "orders-api")]));
      return Promise.resolve(null);
    });
    wrap(<DependencyGroupsPanel {...panelProps} />);
    await screen.findByText("lodash");
    expect(screen.queryByRole("button", { name: /Accept/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Dismiss/ })).toBeNull();
    fireEvent.click(screen.getByLabelText("Expand lodash"));
    await screen.findByText("orders-api");
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  });

  it("renders decided history rows with endpoints and decider", async () => {
    mockApi.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes("/auth/session")) return Promise.resolve(editorUser());
      if (u.includes("/suggestions"))
        return Promise.resolve(
          page([
            {
              ...depItem("d9", "orders-api"),
              status: "ACCEPTED",
              decidedAt: "2026-02-01T00:00:00Z",
              decidedBy: "u-1",
              decidedByName: "Curator",
            },
          ]),
        );
      return Promise.resolve(null);
    });
    wrap(
      <DependencyDecidedList
        params={{}}
        page={1}
        pageSize={25}
        onPageChange={vi.fn()}
        onPageSizeChange={vi.fn()}
      />,
    );
    await screen.findByText("orders-api");
    expect(screen.getByText("depends on")).toBeTruthy();
    expect(screen.getByText("lodash")).toBeTruthy();
    expect(screen.getByText(/Decided by Curator/)).toBeTruthy();
    expect(screen.getByText("Accepted")).toBeTruthy();
  });
});

describe("Suggestions page — kind segment (spec 075 T038)", () => {
  const edgeItem = {
    id: "e-1",
    product: { id: "pr-1", slug: "orders", name: "Orders", type: "BUSINESS_CAPABILITY" },
    component: { id: "c-1", slug: "redis", name: "redis", category: "DATABASE" },
    reason: null,
    score: 0.9,
    status: "PENDING",
    createdAt: "2026-01-01T00:00:00Z",
    decidedAt: null,
    decidedBy: null,
    decidedByName: null,
  };

  it("defaults to the product-edge queue — kind is page state, not an API param", async () => {
    mockApi.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes("/auth/session")) return Promise.resolve(editorUser());
      if (u.startsWith("/suggestions")) return Promise.resolve(page([edgeItem]));
      return Promise.resolve(null);
    });
    wrap(<UxSuggestionsPage />, ["/suggestions"]);
    await screen.findByText("Orders");
    // Exclude the segment chip's dedicated pageSize=1 pending-count poll —
    // `kind` must never reach the main queue's own params.
    const edgeCalls = apiUrls().filter(
      (u) => u.startsWith("/suggestions?") && !u.includes("pageSize=1"),
    );
    expect(edgeCalls.length).toBeGreaterThan(0);
    expect(edgeCalls.every((u) => !u.includes("kind=dependency"))).toBe(true);
    // The dependency groups/list endpoints are never fetched for the queue
    // in the default segment.
    expect(apiUrls().some((u) => u.includes("/suggestions/dependencies"))).toBe(false);
  });

  it("switches to the grouped dependency queue via ?kind=dependency", async () => {
    wrap(<UxSuggestionsPage />, ["/suggestions?kind=dependency"]);
    await screen.findByText("lodash");
    expect(screen.getByText("is used by 3 components")).toBeTruthy();
    expect(
      apiUrls().some((u) => u.includes("/suggestions/dependencies/groups")),
    ).toBe(true);
    // The product-edge queue stays untouched in the dependency segment.
    expect(
      apiUrls().filter(
        (u) => u.startsWith("/suggestions?") && !u.includes("kind=dependency"),
      ).length,
    ).toBe(0);
  });
});

describe("Components list — grouped provider filter (spec 075 UX-LIB-03)", () => {
  it("renders Platforms and Package registries optgroups", async () => {
    wrap(<UxComponentsPage />, ["/components"]);
    const trigger = await screen.findByRole("combobox", { name: "Provider" });
    // jsdom lacks pointer-capture APIs — keyboard opens the Radix Select.
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(await screen.findByText("Package registries")).toBeTruthy();
    expect(screen.getByText("Platforms")).toBeTruthy();
    expect(screen.getByRole("option", { name: "npm" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "GitHub" })).toBeTruthy();
  });
});

describe("Library detail — Package card (spec 075 UX-LIB-04)", () => {
  const library: Component = {
    ...component,
    id: "lib-1",
    name: "lodash",
    slug: "pkg-npm-lodash",
    category: "LIBRARY",
    provider: "NPM",
    resourceType: "npm:package",
    externalId: "pkg:npm/lodash",
    instances: [],
    instanceCount: 0,
  };

  it("renders identity/ecosystem/provider, version chips and the Used-by panel", async () => {
    mockApi.mockImplementation((url: unknown) => {
      const u = String(url);
      if (u.includes("/auth/session")) return Promise.resolve(editorUser());
      if (u.includes("/packages/versions"))
        return Promise.resolve(page([{ version: "4.17.21", componentCount: 9 }]));
      if (u.includes("/packages/consumers"))
        return Promise.resolve(
          page([
            {
              component: { id: "c-1", slug: "orders-api", name: "orders-api", category: "SERVICE" },
              version: "4.17.21",
              scope: "RUNTIME",
              direct: true,
              lastReportedAt: "2026-01-10T00:00:00Z",
            },
          ]),
        );
      return Promise.resolve(null);
    });
    wrap(<LibraryPackageCard component={library} />);
    await screen.findByTestId("versions-in-use");
    // Identity block: purl as MonoValue, ecosystem from the resourceType
    // prefix, provider label.
    expect(screen.getByTitle("pkg:npm/lodash")).toBeTruthy();
    expect(screen.getByText("npm", { selector: "code" })).toBeTruthy();
    expect(screen.getAllByText("npm").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId("version-chip-4.17.21")).toBeTruthy();
    await screen.findByText("orders-api");
    // Chip click filters the Used-by request.
    fireEvent.click(screen.getByTestId("version-chip-4.17.21"));
    await waitFor(() =>
      expect(
        apiUrls().some(
          (u) => u.includes("/packages/consumers") && u.includes("version="),
        ),
      ).toBe(true),
    );
  });
});

describe("Components list — Show libraries (spec 075 UX-LIB-01)", () => {
  it("labels the toggle with the hidden count and sends libraries=true", async () => {
    wrap(<UxComponentsPage />, ["/components"]);
    const toggle = await screen.findByRole("switch", { name: "Show libraries" });
    expect(screen.getByText("Show libraries (3)")).toBeTruthy();
    // Default call omits the libraries param.
    expect(componentListUrls().at(-1)).not.toContain("libraries");
    fireEvent.click(toggle);
    await waitFor(() =>
      expect(componentListUrls().at(-1)).toContain("libraries=true"),
    );
  });

  it("round-trips ?libraries=1 into the API params", async () => {
    wrap(<UxComponentsPage />, ["/components?libraries=1"]);
    await screen.findByRole("switch", { name: "Show libraries" });
    await waitFor(() =>
      expect(componentListUrls().at(-1)).toContain("libraries=true"),
    );
  });
});

describe("Component relationships — libraries summary node (spec 075 UX-LIB-05)", () => {
  const view: ComponentRelationshipsView = {
    component: {
      id: "comp-1",
      name: "payments-api",
      slug: "payments-api",
      category: "SERVICE",
      provider: "GITHUB",
      resourceType: "service",
      lifecycle: "ACTIVE",
    },
    dependsOn: [],
    dependedOnBy: [],
    sourcesFrom: [],
    sourcedBy: [],
    exposes: [],
    exposedBy: [],
    productDependents: { direct: [], viaGroups: [] },
    instances: [],
    libraryCounts: { dependsOn: 212, dependedOnBy: 0 },
    unavailableKinds: [],
  };

  it("renders one bounded 'N libraries' node linking to the BOM tab", async () => {
    wrap(<ComponentRelationships view={view} />);
    const node = await screen.findByTestId("libraries-summary-dependsOn");
    expect(node.textContent).toContain("212 libraries");
    expect(node.getAttribute("href")).toBe("/components/payments-api?tab=bom");
    // No individual library nodes.
    expect(screen.queryByText("No relationships yet")).toBeNull();
  });

  it("links the dependedOnBy count to the library's Used-by surface", async () => {
    wrap(
      <ComponentRelationships
        view={{ ...view, libraryCounts: { dependsOn: 0, dependedOnBy: 7 } }}
      />,
    );
    const node = await screen.findByTestId("libraries-summary-dependedOnBy");
    expect(node.textContent).toContain("7 libraries");
    expect(node.getAttribute("href")).toBe("/components/payments-api");
  });
});
