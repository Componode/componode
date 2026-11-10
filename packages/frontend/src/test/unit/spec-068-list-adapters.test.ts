import { describe, it, expect, vi, beforeEach } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  componentsListParams,
  useComponents,
  COMPONENTS_SORT_KEYS,
  COMPONENTS_FILTER_KEYS,
} from "@/api/hooks/components";
import {
  productsListParams,
  useProducts,
  PRODUCTS_SORT_KEYS,
  PRODUCTS_FILTER_KEYS,
  PRODUCTS_MISSING_INCOMPLETE,
} from "@/api/hooks/products";
import {
  componentGroupsListParams,
  useComponentGroups,
  useAllComponentGroups,
  COMPONENT_GROUPS_SORT_KEYS,
  COMPONENT_GROUPS_FILTER_KEYS,
} from "@/api/hooks/component-groups";
import {
  agentsListParams,
  useAgents,
  useAllAgents,
  AGENTS_SORT_KEYS,
  AGENTS_FILTER_KEYS,
} from "@/api/hooks/agents";
import {
  importerSourcesListParams,
  useImporterSources,
  IMPORTER_SOURCES_SORT_KEYS,
  IMPORTER_SOURCES_FILTER_KEYS,
} from "@/api/hooks/importer-sources";
import {
  dockerTargetsListParams,
  useDockerTargets,
  DOCKER_TARGETS_SORT_KEYS,
} from "@/api/hooks/docker-targets";
import {
  importerConfigsListParams,
  importerRunsListParams,
  useImporterConfigs,
  useImporterRuns,
  IMPORTER_CONFIGS_SORT_KEYS,
  IMPORTER_CONFIGS_FILTER_KEYS,
  IMPORTER_RUNS_SORT_KEYS,
  IMPORTER_RUNS_FILTER_KEYS,
} from "@/api/hooks/importers";
import {
  suggestionsListParams,
  useSuggestions,
  SUGGESTIONS_SORT_KEYS,
  SUGGESTIONS_FILTER_KEYS,
} from "@/api/hooks/suggestions";
import {
  activityFeedParams,
  useActivityFeed,
  AUDIT_SORT_KEYS,
  ACTIVITY_FILTER_KEYS,
} from "@/api/hooks/audit";
import { api } from "@/api/client";
import type { ListQueryState } from "@/api/list-query";

vi.mock("@/api/client", () => ({ api: vi.fn() }));

/**
 * Spec 068 page adapters — the resolved `useListState` shape → contract
 * params for /components, /products, and /component-groups, plus the
 * request URLs the paged hooks actually send.
 */

const state = (over: Partial<ListQueryState> = {}): ListQueryState => ({
  page: 1,
  pageSize: 25,
  sort: null,
  order: "asc",
  search: "",
  filters: {},
  ...over,
});

const EMPTY_PAGINATION = { page: 1, pageSize: 25, total: 0, pageCount: 0, hasNext: false };

it("declares the expected URL filter keys per page", () => {
  expect(COMPONENTS_FILTER_KEYS).toEqual(["provider", "category", "lifecycle", "wired", "gone"]);
  expect(PRODUCTS_FILTER_KEYS).toEqual(["type", "criticality", "lifecycle", "missing"]);
  expect(COMPONENT_GROUPS_FILTER_KEYS).toEqual(["lifecycle"]);
  expect(AGENTS_FILTER_KEYS).toEqual(["status"]);
  expect(IMPORTER_SOURCES_FILTER_KEYS).toEqual(["status", "importerName"]);
  expect(IMPORTER_CONFIGS_FILTER_KEYS).toEqual(["enabled", "importerName"]);
  expect(IMPORTER_RUNS_FILTER_KEYS).toEqual(["status"]);
  expect(SUGGESTIONS_FILTER_KEYS).toEqual(["status"]);
  expect(ACTIVITY_FILTER_KEYS).toEqual(["kind", "entityType", "action", "actor", "from", "to"]);
});

// --- componentsListParams -------------------------------------------------

describe("componentsListParams (spec 068)", () => {
  it("maps gone=hide → includeGone=false and gone=show → includeGone=true", () => {
    expect(
      componentsListParams(state({ filters: { gone: "hide" } })).includeGone,
    ).toBe(false);
    expect(
      componentsListParams(state({ filters: { gone: "show" } })).includeGone,
    ).toBe(true);
    // No third domain value exists — the URL filter whitelist is hide|show.
    expect(componentsListParams(state({ filters: {} })).includeGone).toBe(false);
  });

  it("treats 'all' as unset for facet filters and always sends includeRetired", () => {
    const p = componentsListParams(
      state({ filters: { provider: "all", category: "all", lifecycle: "all", wired: "all", gone: "hide" } }),
    );
    expect(p.provider).toBeUndefined();
    expect(p.category).toBeUndefined();
    expect(p.lifecycle).toBeUndefined();
    expect(p.wired).toBeUndefined();
    expect(p.includeRetired).toBe(true);
    expect(p.includeGone).toBe(false);
  });

  it("passes concrete facet values through verbatim", () => {
    const p = componentsListParams(
      state({ filters: { provider: "AWS", category: "DATABASE", lifecycle: "RETIRED", wired: "unwired", gone: "show" } }),
    );
    expect(p.provider).toBe("AWS");
    expect(p.category).toBe("DATABASE");
    expect(p.lifecycle).toBe("RETIRED");
    expect(p.wired).toBe("unwired");
    expect(p.includeGone).toBe(true);
  });

  it("passes every contract sort key through and defaults to name", () => {
    for (const sort of COMPONENTS_SORT_KEYS) {
      expect(componentsListParams(state({ sort })).sort).toBe(sort);
    }
    expect(componentsListParams(state({ sort: null })).sort).toBe("name");
    // createdAt is NOT in the whitelist — the page cannot emit it.
    expect(COMPONENTS_SORT_KEYS).not.toContain("createdAt");
  });

  it("wires page/pageSize/search/order into the params", () => {
    const p = componentsListParams(
      state({ page: 3, pageSize: 50, sort: "health", order: "desc", search: "redis" }),
    );
    expect(p.page).toBe(3);
    expect(p.pageSize).toBe(50);
    expect(p.sort).toBe("health");
    expect(p.order).toBe("desc");
    expect(p.search).toBe("redis");
    expect(componentsListParams(state({ search: "" })).search).toBeUndefined();
  });
});

// --- productsListParams ---------------------------------------------------

describe("productsListParams (spec 068)", () => {
  it("expands missing=incomplete to the all-facets CSV and passes facets through", () => {
    expect(productsListParams(state({ filters: { missing: "incomplete" } })).missing).toBe(
      PRODUCTS_MISSING_INCOMPLETE,
    );
    expect(productsListParams(state({ filters: { missing: "owner" } })).missing).toBe("owner");
    expect(productsListParams(state({ filters: { missing: "dependencies" } })).missing).toBe("dependencies");
    expect(productsListParams(state({ filters: { missing: "all" } })).missing).toBeUndefined();
    expect(productsListParams(state({ filters: {} })).missing).toBeUndefined();
  });

  it("sends lifecycle=ACTIVE by default, omits it for 'all', sends RETIRED verbatim", () => {
    const active = productsListParams(state({ filters: { lifecycle: "ACTIVE" } }));
    expect(active.lifecycle).toBe("ACTIVE");
    expect(active.includeRetired).toBe(true);

    const all = productsListParams(state({ filters: { lifecycle: "all" } }));
    expect(all.lifecycle).toBeUndefined();
    expect(all.includeRetired).toBe(true);

    const retired = productsListParams(state({ filters: { lifecycle: "RETIRED" } }));
    expect(retired.lifecycle).toBe("RETIRED");
    expect(retired.includeRetired).toBe(true);
  });

  it("passes the contract sort whitelist (updated, not updatedAt) and defaults to name", () => {
    for (const sort of PRODUCTS_SORT_KEYS) {
      expect(productsListParams(state({ sort })).sort).toBe(sort);
    }
    expect(productsListParams(state({ sort: null })).sort).toBe("name");
    // App-computed columns are deliberately absent from the whitelist.
    for (const banned of ["health", "components", "completeness", "updatedAt"]) {
      expect(PRODUCTS_SORT_KEYS).not.toContain(banned);
    }
  });

  it("wires page/pageSize/search/order into the params", () => {
    const p = productsListParams(
      state({ page: 2, pageSize: 100, sort: "updated", order: "desc", search: "checkout", filters: { type: "PLATFORM", criticality: "TIER_1" } }),
    );
    expect(p.page).toBe(2);
    expect(p.pageSize).toBe(100);
    expect(p.sort).toBe("updated");
    expect(p.order).toBe("desc");
    expect(p.search).toBe("checkout");
    expect(p.type).toBe("PLATFORM");
    expect(p.criticality).toBe("TIER_1");
  });
});

// --- componentGroupsListParams ---------------------------------------------

describe("componentGroupsListParams (spec 068)", () => {
  it("maps lifecycle: concrete value verbatim, 'all' → includeRetired=true", () => {
    const active = componentGroupsListParams(state({ filters: { lifecycle: "ACTIVE" } }));
    expect(active.lifecycle).toBe("ACTIVE");
    expect(active.includeRetired).toBeUndefined();

    const retired = componentGroupsListParams(state({ filters: { lifecycle: "RETIRED" } }));
    expect(retired.lifecycle).toBe("RETIRED");
    expect(retired.includeRetired).toBeUndefined();

    const all = componentGroupsListParams(state({ filters: { lifecycle: "all" } }));
    expect(all.lifecycle).toBeUndefined();
    expect(all.includeRetired).toBe(true);
  });

  it("passes the contract sort whitelist and defaults to name asc", () => {
    for (const sort of COMPONENT_GROUPS_SORT_KEYS) {
      expect(componentGroupsListParams(state({ sort })).sort).toBe(sort);
    }
    expect(componentGroupsListParams(state({ sort: null })).sort).toBe("name");
    expect(componentGroupsListParams(state({ order: "desc" })).order).toBe("desc");
  });

  it("wires page/pageSize/search into the params", () => {
    const p = componentGroupsListParams(
      state({ page: 4, pageSize: 50, search: "dockers", filters: { lifecycle: "all" } }),
    );
    expect(p.page).toBe(4);
    expect(p.pageSize).toBe(50);
    expect(p.search).toBe("dockers");
    expect(p.includeRetired).toBe(true);
  });
});

// --- agentsListParams ------------------------------------------------------

describe("agentsListParams (spec 068)", () => {
  it("treats status='all' as unset and passes concrete statuses through", () => {
    expect(agentsListParams(state({ filters: { status: "all" } })).status).toBeUndefined();
    expect(agentsListParams(state({ filters: {} })).status).toBeUndefined();
    expect(agentsListParams(state({ filters: { status: "OFFLINE" } })).status).toBe("OFFLINE");
  });

  it("passes the contract sort whitelist and defaults to name", () => {
    for (const sort of AGENTS_SORT_KEYS) {
      expect(agentsListParams(state({ sort })).sort).toBe(sort);
    }
    expect(agentsListParams(state({ sort: null })).sort).toBe("name");
    expect(AGENTS_SORT_KEYS).toEqual([
      "name",
      "status",
      "agentVersion",
      "boundConfigCount",
      "lastSeenAt",
      "createdAt",
    ]);
  });

  it("wires page/pageSize/search/order into the params", () => {
    const p = agentsListParams(
      state({ page: 2, pageSize: 100, sort: "lastSeenAt", order: "desc", search: "build" }),
    );
    expect(p.page).toBe(2);
    expect(p.pageSize).toBe(100);
    expect(p.sort).toBe("lastSeenAt");
    expect(p.order).toBe("desc");
    expect(p.search).toBe("build");
    expect(agentsListParams(state({ search: "" })).search).toBeUndefined();
  });
});

// --- importerSourcesListParams ---------------------------------------------

describe("importerSourcesListParams (spec 068)", () => {
  it("treats 'all' sentinels as unset for status and importerName", () => {
    const p = importerSourcesListParams(
      state({ filters: { status: "all", importerName: "all" } }),
    );
    expect(p.status).toBeUndefined();
    expect(p.importerName).toBeUndefined();
    const q = importerSourcesListParams(
      state({ filters: { status: "UNMONITORED", importerName: "github" } }),
    );
    expect(q.status).toBe("UNMONITORED");
    expect(q.importerName).toBe("github");
  });

  it("passes the contract sort whitelist and defaults to createdAt", () => {
    for (const sort of IMPORTER_SOURCES_SORT_KEYS) {
      expect(importerSourcesListParams(state({ sort })).sort).toBe(sort);
    }
    expect(importerSourcesListParams(state({ sort: null })).sort).toBe("createdAt");
    expect(IMPORTER_SOURCES_SORT_KEYS).toEqual([
      "name",
      "importerName",
      "status",
      "boundConfig",
      "components",
      "instances",
      "lastCompletedRunAt",
      "createdAt",
    ]);
  });

  it("wires page/pageSize/search/order into the params", () => {
    const p = importerSourcesListParams(
      state({ page: 3, pageSize: 50, sort: "name", order: "asc", search: "prod" }),
    );
    expect(p.page).toBe(3);
    expect(p.pageSize).toBe(50);
    expect(p.sort).toBe("name");
    expect(p.order).toBe("asc");
    expect(p.search).toBe("prod");
  });
});

// --- dockerTargetsListParams ------------------------------------------------

describe("dockerTargetsListParams (spec 068)", () => {
  it("has no filters — only page/pageSize/sort/order/search", () => {
    const p = dockerTargetsListParams(
      state({ page: 2, pageSize: 50, sort: "createdAt", order: "desc", search: "prod", filters: { stray: "x" } }),
    );
    expect(p.page).toBe(2);
    expect(p.pageSize).toBe(50);
    expect(p.sort).toBe("createdAt");
    expect(p.order).toBe("desc");
    expect(p.search).toBe("prod");
    expect("status" in p).toBe(false);
  });

  it("passes the contract sort whitelist and defaults to name", () => {
    for (const sort of DOCKER_TARGETS_SORT_KEYS) {
      expect(dockerTargetsListParams(state({ sort })).sort).toBe(sort);
    }
    expect(dockerTargetsListParams(state({ sort: null })).sort).toBe("name");
    expect(DOCKER_TARGETS_SORT_KEYS).toEqual(["name", "targetId", "enabled", "createdAt"]);
  });
});

// --- importerConfigsListParams ----------------------------------------------

describe("importerConfigsListParams (spec 068)", () => {
  it("maps enabled='all' to unset and passes 'true'/'false' verbatim", () => {
    expect(
      importerConfigsListParams(state({ filters: { enabled: "all" } })).enabled,
    ).toBeUndefined();
    expect(
      importerConfigsListParams(state({ filters: { enabled: "true" } })).enabled,
    ).toBe("true");
    expect(
      importerConfigsListParams(state({ filters: { enabled: "false" } })).enabled,
    ).toBe("false");
    expect(
      importerConfigsListParams(state({ filters: { importerName: "all" } })).importerName,
    ).toBeUndefined();
    expect(
      importerConfigsListParams(state({ filters: { importerName: "aws" } })).importerName,
    ).toBe("aws");
  });

  it("passes the contract sort whitelist and defaults to createdAt", () => {
    for (const sort of IMPORTER_CONFIGS_SORT_KEYS) {
      expect(importerConfigsListParams(state({ sort })).sort).toBe(sort);
    }
    expect(importerConfigsListParams(state({ sort: null })).sort).toBe("createdAt");
    expect(IMPORTER_CONFIGS_SORT_KEYS).toEqual([
      "name",
      "importerName",
      "enabled",
      "createdAt",
      "updatedAt",
    ]);
  });

  it("wires page/pageSize/search/order into the params", () => {
    const p = importerConfigsListParams(
      state({ page: 4, pageSize: 25, sort: "updatedAt", order: "asc", search: "nightly" }),
    );
    expect(p.page).toBe(4);
    expect(p.sort).toBe("updatedAt");
    expect(p.order).toBe("asc");
    expect(p.search).toBe("nightly");
  });
});

// --- importerRunsListParams --------------------------------------------------

describe("importerRunsListParams (spec 068)", () => {
  it("treats status='all' as unset and passes run statuses through", () => {
    expect(importerRunsListParams(state({ filters: { status: "all" } })).status).toBeUndefined();
    expect(importerRunsListParams(state({ filters: {} })).status).toBeUndefined();
    expect(importerRunsListParams(state({ filters: { status: "FAILED" } })).status).toBe("FAILED");
  });

  it("passes the contract sort whitelist and defaults to createdAt", () => {
    for (const sort of IMPORTER_RUNS_SORT_KEYS) {
      expect(importerRunsListParams(state({ sort })).sort).toBe(sort);
    }
    expect(importerRunsListParams(state({ sort: null })).sort).toBe("createdAt");
    expect(IMPORTER_RUNS_SORT_KEYS).toEqual([
      "createdAt",
      "startedAt",
      "status",
      "completedAt",
      "assetsProcessed",
    ]);
  });

  it("wires page/pageSize/order into the params (no search on this endpoint — T061)", () => {
    const p = importerRunsListParams(
      state({ page: 2, pageSize: 50, sort: "startedAt", order: "asc", search: "x" }),
    );
    expect(p.page).toBe(2);
    expect(p.pageSize).toBe(50);
    expect(p.sort).toBe("startedAt");
    expect(p.order).toBe("asc");
    expect("search" in p).toBe(false);
  });
});

// --- suggestionsListParams ---------------------------------------------------

describe("suggestionsListParams (spec 068)", () => {
  it("maps the status filter to the API view — anything but DECIDED/DISMISSED is PENDING", () => {
    expect(suggestionsListParams(state({ filters: { status: "DECIDED" } })).status).toBe("DECIDED");
    expect(suggestionsListParams(state({ filters: { status: "DISMISSED" } })).status).toBe("DISMISSED");
    expect(suggestionsListParams(state({ filters: { status: "PENDING" } })).status).toBe("PENDING");
    expect(suggestionsListParams(state({ filters: { status: "all" } })).status).toBe("PENDING");
    expect(suggestionsListParams(state({ filters: {} })).status).toBe("PENDING");
  });

  it("passes the contract sort whitelist and defaults to score", () => {
    for (const sort of SUGGESTIONS_SORT_KEYS) {
      expect(suggestionsListParams(state({ sort })).sort).toBe(sort);
    }
    expect(suggestionsListParams(state({ sort: null })).sort).toBe("score");
    expect(SUGGESTIONS_SORT_KEYS).toEqual([
      "score",
      "createdAt",
      "decidedAt",
      "status",
    ]);
  });

  it("wires page/pageSize/order into the params (no search on this endpoint)", () => {
    const p = suggestionsListParams(
      state({ page: 3, pageSize: 50, sort: "decidedAt", order: "asc", search: "ignored" }),
    );
    expect(p.page).toBe(3);
    expect(p.pageSize).toBe(50);
    expect(p.sort).toBe("decidedAt");
    expect(p.order).toBe("asc");
    expect("search" in p).toBe(false);
  });
});

// --- activityFeedParams ------------------------------------------------------

describe("activityFeedParams (spec 068)", () => {
  it("treats 'all' sentinels as unset for every filter", () => {
    const p = activityFeedParams(
      state({
        filters: { kind: "all", entityType: "all", action: "all", actor: "all", from: "all", to: "all" },
      }),
    );
    expect(p.kind).toBeUndefined();
    expect(p.entityType).toBeUndefined();
    expect(p.action).toBeUndefined();
    expect(p.actor).toBeUndefined();
    expect(p.from).toBeUndefined();
    expect(p.to).toBeUndefined();
  });

  it("passes concrete filters through and converts datetime-local to ISO", () => {
    const p = activityFeedParams(
      state({
        filters: {
          kind: "edge",
          entityType: "component",
          action: "created",
          actor: "ana",
          from: "2026-01-01T00:00",
          to: "2026-02-01T23:59",
        },
      }),
    );
    expect(p.kind).toBe("edge");
    expect(p.entityType).toBe("component");
    expect(p.action).toBe("created");
    expect(p.actor).toBe("ana");
    // datetime-local has no zone — Date.parse treats it as local time; the
    // assertion only requires a valid ISO instant, not a specific offset.
    expect(p.from).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(p.to).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(Number.isNaN(Date.parse(p.from!))).toBe(false);
  });

  it("drops unparseable from/to hand-edits instead of emitting a 400", () => {
    const p = activityFeedParams(state({ filters: { from: "not-a-date", to: "all" } }));
    expect(p.from).toBeUndefined();
    expect(p.to).toBeUndefined();
  });

  it("passes the contract sort whitelist", () => {
    for (const sort of AUDIT_SORT_KEYS) {
      expect(activityFeedParams(state({ sort })).sort).toBe(sort);
    }
    expect(activityFeedParams(state({ sort: null })).sort).toBeUndefined();
    expect(AUDIT_SORT_KEYS).toEqual([
      "createdAt",
      "action",
      "actor",
      "kind",
      "entityType",
    ]);
  });

  it("wires page/pageSize/order into the params", () => {
    const p = activityFeedParams(
      state({ page: 5, pageSize: 100, sort: "actor", order: "asc" }),
    );
    expect(p.page).toBe(5);
    expect(p.pageSize).toBe(100);
    expect(p.sort).toBe("actor");
    expect(p.order).toBe("asc");
  });
});

// --- hook request URLs -----------------------------------------------------

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: qc }, children);
};

const requestedUrl = () => String(vi.mocked(api).mock.calls.at(-1)?.[0]);

beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.mocked(api).mockResolvedValue({ data: [], pagination: EMPTY_PAGINATION, edges: [] } as never);
});

describe("paged hook request URLs (spec 068)", () => {
  it("useComponents sends page/pageSize/sort/order/search + includeGone=false", async () => {
    renderHook(
      () =>
        useComponents(
          componentsListParams(
            state({
              page: 2,
              pageSize: 50,
              sort: "lastSeenAt",
              order: "desc",
              search: "redis",
              filters: { provider: "AWS", gone: "hide" },
            }),
          ),
        ),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(api).toHaveBeenCalled());
    const url = requestedUrl();
    expect(url).toContain("/components?");
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("page")).toBe("2");
    expect(qs.get("pageSize")).toBe("50");
    expect(qs.get("sort")).toBe("lastSeenAt");
    expect(qs.get("order")).toBe("desc");
    expect(qs.get("search")).toBe("redis");
    expect(qs.get("provider")).toBe("AWS");
    expect(qs.get("includeGone")).toBe("false");
    expect(qs.get("includeRetired")).toBe("true");
    expect(qs.get("gone")).toBeNull(); // sentinel never leaks to the API
  });

  it("useComponents sends includeGone=true for gone=show", async () => {
    renderHook(
      () => useComponents(componentsListParams(state({ filters: { gone: "show" } }))),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(new URLSearchParams(requestedUrl().split("?")[1]).get("includeGone")).toBe("true");
  });

  it("useProducts sends search (never q), the missing CSV, and sort=updated", async () => {
    renderHook(
      () =>
        useProducts(
          productsListParams(
            state({
              page: 3,
              sort: "updated",
              order: "desc",
              search: "billing",
              filters: { lifecycle: "all", missing: "incomplete" },
            }),
          ),
        ),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(api).toHaveBeenCalled());
    const url = requestedUrl();
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(url).toContain("/products?");
    expect(qs.get("page")).toBe("3");
    expect(qs.get("sort")).toBe("updated");
    expect(qs.get("order")).toBe("desc");
    expect(qs.get("search")).toBe("billing");
    expect(qs.get("q")).toBeNull(); // legacy param is gone (strict schema)
    expect(qs.get("missing")).toBe("owner,dependencies,description");
    expect(qs.get("lifecycle")).toBeNull(); // "all" → omitted; includeRetired covers it
    expect(qs.get("includeRetired")).toBe("true");
  });

  it("useComponentGroups sends lifecycle verbatim and includeRetired for 'all'", async () => {
    renderHook(
      () => useComponentGroups(componentGroupsListParams(state({ filters: { lifecycle: "RETIRED" } }))),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(api).toHaveBeenCalled());
    let qs = new URLSearchParams(requestedUrl().split("?")[1]);
    expect(qs.get("lifecycle")).toBe("RETIRED");
    expect(qs.get("includeRetired")).toBeNull();

    renderHook(
      () => useComponentGroups(componentGroupsListParams(state({ filters: { lifecycle: "all" }, sort: "createdAt", order: "desc" }))),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(api).toHaveBeenCalledTimes(2));
    qs = new URLSearchParams(requestedUrl().split("?")[1]);
    expect(qs.get("lifecycle")).toBeNull();
    expect(qs.get("includeRetired")).toBe("true");
    expect(qs.get("sort")).toBe("createdAt");
    expect(qs.get("order")).toBe("desc");
  });
});

// --- fetch-all helpers -----------------------------------------------------

describe("useAllComponentGroups fetch-all sweep", () => {
  it("pages at pageSize=100 until hasNext is false and flattens data", async () => {
    vi.mocked(api)
      .mockResolvedValueOnce({
        data: [{ id: "g1" }],
        pagination: { page: 1, pageSize: 100, total: 2, pageCount: 2, hasNext: true },
      } as never)
      .mockResolvedValueOnce({
        data: [{ id: "g2" }],
        pagination: { page: 2, pageSize: 100, total: 2, pageCount: 2, hasNext: false },
      } as never);
    const { result } = renderHook(() => useAllComponentGroups(), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((g) => g.id)).toEqual(["g1", "g2"]);
    expect(vi.mocked(api).mock.calls).toHaveLength(2);
    expect(String(vi.mocked(api).mock.calls[0]?.[0])).toContain("pageSize=100");
    expect(String(vi.mocked(api).mock.calls[1]?.[0])).toContain("page=2");
  });
});

// --- spec-068 page hooks: request URLs + envelope parsing -------------------

describe("spec-068 page hooks — request URLs", () => {
  it("useAgents sends page/pageSize/sort/order/search/status and parses {data,pagination}", async () => {
    vi.mocked(api).mockResolvedValue({
      data: [{ id: "a1", name: "build-1" }],
      pagination: { page: 2, pageSize: 50, total: 51, pageCount: 2, hasNext: false },
    } as never);
    const { result } = renderHook(
      () =>
        useAgents(
          agentsListParams(
            state({
              page: 2,
              pageSize: 50,
              sort: "status",
              order: "desc",
              search: "build",
              filters: { status: "OFFLINE" },
            }),
          ),
          { refetchInterval: false },
        ),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = requestedUrl();
    expect(url).toContain("/agents?");
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("page")).toBe("2");
    expect(qs.get("pageSize")).toBe("50");
    expect(qs.get("sort")).toBe("status");
    expect(qs.get("order")).toBe("desc");
    expect(qs.get("search")).toBe("build");
    expect(qs.get("status")).toBe("OFFLINE");
    // Envelope parsing — the page reads data.data + data.pagination.
    expect(result.current.data?.data).toHaveLength(1);
    expect(result.current.data?.pagination.total).toBe(51);
  });

  it("useImporterSources sends the status/importerName filters verbatim", async () => {
    renderHook(
      () =>
        useImporterSources(
          importerSourcesListParams(
            state({
              page: 1,
              pageSize: 25,
              sort: "lastCompletedRunAt",
              order: "desc",
              search: "repo",
              filters: { status: "ACTIVE", importerName: "github" },
            }),
          ),
        ),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(api).toHaveBeenCalled());
    const url = requestedUrl();
    expect(url).toContain("/importer-sources?");
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("sort")).toBe("lastCompletedRunAt");
    expect(qs.get("order")).toBe("desc");
    expect(qs.get("search")).toBe("repo");
    expect(qs.get("status")).toBe("ACTIVE");
    expect(qs.get("importerName")).toBe("github");
  });

  it("useDockerTargets sends only contract params (no filter keys exist)", async () => {
    renderHook(
      () =>
        useDockerTargets(
          dockerTargetsListParams(
            state({ page: 3, pageSize: 100, sort: "createdAt", order: "asc", search: "edge" }),
          ),
        ),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(api).toHaveBeenCalled());
    const url = requestedUrl();
    expect(url).toContain("/docker-targets?");
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("page")).toBe("3");
    expect(qs.get("pageSize")).toBe("100");
    expect(qs.get("sort")).toBe("createdAt");
    expect(qs.get("order")).toBe("asc");
    expect(qs.get("search")).toBe("edge");
    expect(qs.get("status")).toBeNull();
    expect(qs.get("enabled")).toBeNull();
  });

  it("useImporterConfigs sends enabled as a string and parses the envelope", async () => {
    vi.mocked(api).mockResolvedValue({
      data: [{ id: "c1", label: "nightly" }],
      pagination: { page: 1, pageSize: 25, total: 1, pageCount: 1, hasNext: false },
    } as never);
    const { result } = renderHook(
      () =>
        useImporterConfigs(
          importerConfigsListParams(
            state({
              sort: "enabled",
              order: "desc",
              filters: { enabled: "true", importerName: "aws" },
            }),
          ),
        ),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = requestedUrl();
    expect(url).toContain("/importer-configs?");
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("enabled")).toBe("true");
    expect(qs.get("importerName")).toBe("aws");
    expect(qs.get("sort")).toBe("enabled");
    expect(result.current.data?.data).toHaveLength(1);
    expect(result.current.data?.pagination.pageCount).toBe(1);
  });

  it("useImporterRuns hits the nested runs route with the run filters", async () => {
    renderHook(
      () =>
        useImporterRuns(
          "cfg-1",
          importerRunsListParams(
            state({ page: 2, sort: "startedAt", order: "asc", filters: { status: "RUNNING" } }),
          ),
        ),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(api).toHaveBeenCalled());
    const url = requestedUrl();
    expect(url).toContain("/importer-configs/cfg-1/runs?");
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("page")).toBe("2");
    expect(qs.get("sort")).toBe("startedAt");
    expect(qs.get("order")).toBe("asc");
    expect(qs.get("status")).toBe("RUNNING");
  });
});

describe("spec-068 compat envelopes — parsing", () => {
  it("useSuggestions maps {data,pagination} onto the items+flat-fields feed", async () => {
    vi.mocked(api).mockResolvedValue({
      data: [{ id: "s1", status: "PENDING" }],
      pagination: { page: 1, pageSize: 25, total: 42, pageCount: 2, hasNext: true },
    } as never);
    const { result } = renderHook(() => useSuggestions("PENDING", { page: 1, pageSize: 25 }), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    // Compat view: items + flat pagination fields for pre-068 consumers.
    expect(result.current.data?.items).toHaveLength(1);
    expect(result.current.data?.total).toBe(42);
    expect(result.current.data?.page).toBe(1);
    expect(result.current.data?.pageCount).toBe(2);
    expect(result.current.data?.hasNext).toBe(true);
    const url = requestedUrl();
    expect(url).toContain("/suggestions?");
    const qs = new URLSearchParams(url.split("?")[1]);
    expect(qs.get("status")).toBe("PENDING");
    expect(qs.get("page")).toBe("1");
    expect(qs.get("pageSize")).toBe("25");
    // Legacy limit/offset spellings never leak (strict schema).
    expect(qs.get("limit")).toBeNull();
    expect(qs.get("offset")).toBeNull();
  });

  it("useSuggestions passes the options object through as page/pageSize (spec 069)", async () => {
    renderHook(() => useSuggestions("DECIDED", { page: 2, pageSize: 50 }), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(api).toHaveBeenCalled());
    const qs = new URLSearchParams(requestedUrl().split("?")[1]);
    expect(qs.get("status")).toBe("DECIDED");
    expect(qs.get("page")).toBe("2");
    expect(qs.get("pageSize")).toBe("50");
  });

  it("useActivityFeed sends page/pageSize verbatim — no legacy translation (spec 069)", async () => {
    vi.mocked(api).mockResolvedValue({
      data: [{ id: "e1", kind: "entity" }],
      pagination: { page: 1, pageSize: 5, total: 9, pageCount: 2, hasNext: true },
    } as never);
    const { result } = renderHook(() => useActivityFeed({ pageSize: 5 }), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const qs = new URLSearchParams(requestedUrl().split("?")[1]);
    expect(requestedUrl()).toContain("/audit/activity?");
    expect(qs.get("pageSize")).toBe("5");
    expect(result.current.data?.items).toHaveLength(1);
    expect(result.current.data?.total).toBe(9);
    expect(result.current.data?.hasNext).toBe(true);
  });

  it("useAllAgents sweeps pages at pageSize=100 until hasNext is false", async () => {
    vi.mocked(api)
      .mockResolvedValueOnce({
        data: [{ id: "a1" }],
        pagination: { page: 1, pageSize: 100, total: 2, pageCount: 2, hasNext: true },
      } as never)
      .mockResolvedValueOnce({
        data: [{ id: "a2" }],
        pagination: { page: 2, pageSize: 100, total: 2, pageCount: 2, hasNext: false },
      } as never);
    const { result } = renderHook(() => useAllAgents({ refetchInterval: false }), {
      wrapper: makeWrapper(),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(vi.mocked(api).mock.calls).toHaveLength(2);
    expect(String(vi.mocked(api).mock.calls[0]?.[0])).toContain("pageSize=100");
  });
});
