import { describe, it, expect, afterEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useListState, type ListStateConfig } from "@/ux/hooks/use-list-state";
import { useClampPage } from "@/ux/hooks/use-clamp-page";
import { useDebouncedValue } from "@/ux/hooks/use-debounced-value";
import { buildListQueryString } from "@/api/list-query";
import { ListToolbar, type FilterDef } from "@/ux/components/patterns/list-toolbar";
import { ListPagination } from "@/ux/components/patterns/list-pagination";
import { SortableTableHead } from "@/ux/components/patterns/sortable-header";
import {
  SUMMARY_FIELDS,
  TitleWithSummary,
  summaryFieldsFor,
} from "@/ux/components/patterns/title-with-summary";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table";
import type { Component } from "@/ux/lib/view-types";

const wrap = (entry: string) =>
  function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>;
  };

function useProbe(config?: ListStateConfig) {
  return { list: useListState(config), search: useLocation().search };
}

const CONFIG = {
  sortKeys: ["name", "lastSeenAt"] as const,
  filters: {
    provider: { default: "all", values: ["all", "GITHUB", "AWS"] },
    gone: { default: "hide", values: ["hide", "show"] },
    status: {
      default: "",
      isValid: (v: string) => v.split(",").every((x) => ["RUNNING", "ERROR"].includes(x)),
    },
  },
} satisfies ListStateConfig<"name" | "lastSeenAt", "provider" | "gone" | "status">;

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useListState", () => {
  it("resolves defaults on a bare URL", () => {
    const { result } = renderHook(() => useProbe(CONFIG), { wrapper: wrap("/components") });
    expect(result.current.list.page).toBe(1);
    expect(result.current.list.pageSize).toBe(25);
    expect(result.current.list.sort).toBe("name");
    expect(result.current.list.order).toBe("asc");
    expect(result.current.list.search).toBe("");
    expect(result.current.list.filters).toEqual({ provider: "all", gone: "hide", status: "" });
  });

  it("reads valid params from the URL", () => {
    const { result } = renderHook(() => useProbe(CONFIG), {
      wrapper: wrap("/components?page=3&size=50&sort=lastSeenAt&order=desc&q=redis&provider=AWS&gone=show"),
    });
    const l = result.current.list;
    expect(l.page).toBe(3);
    expect(l.pageSize).toBe(50);
    expect(l.sort).toBe("lastSeenAt");
    expect(l.order).toBe("desc");
    expect(l.search).toBe("redis");
    expect(l.filters.provider).toBe("AWS");
    expect(l.filters.gone).toBe("show");
  });

  it("falls back to defaults on invalid values — never errors", () => {
    const { result } = renderHook(() => useProbe(CONFIG), {
      wrapper: wrap("/components?page=abc&size=37&sort=bogus&order=sideways&provider=NOPE&gone=maybe"),
    });
    const l = result.current.list;
    expect(l.page).toBe(1);
    expect(l.pageSize).toBe(25);
    expect(l.sort).toBe("name");
    expect(l.order).toBe("asc");
    expect(l.filters.provider).toBe("all");
    expect(l.filters.gone).toBe("hide");
  });

  it("setPage preserves all other state", () => {
    const { result } = renderHook(() => useProbe(CONFIG), {
      wrapper: wrap("/components?provider=AWS&sort=lastSeenAt&order=desc&q=redis"),
    });
    act(() => result.current.list.setPage(4));
    expect(result.current.search).toBe("?provider=AWS&sort=lastSeenAt&order=desc&q=redis&page=4");
    expect(result.current.list.page).toBe(4);
  });

  it("search/filter/sort/order/pageSize changes reset page to 1", () => {
    const { result } = renderHook(() => useProbe(CONFIG), {
      wrapper: wrap("/components?page=3"),
    });
    act(() => result.current.list.setSearch("x"));
    expect(result.current.list.page).toBe(1);
    act(() => result.current.list.setPage(5));
    act(() => result.current.list.setFilter("provider", "AWS"));
    expect(result.current.list.page).toBe(1);
    expect(result.current.list.filters.provider).toBe("AWS");
    act(() => result.current.list.setPage(2));
    act(() => result.current.list.setSort("lastSeenAt"));
    expect(result.current.list.page).toBe(1);
    expect(result.current.list.sort).toBe("lastSeenAt");
    act(() => result.current.list.setPage(2));
    act(() => result.current.list.setOrder("desc"));
    expect(result.current.list.page).toBe(1);
    expect(result.current.list.order).toBe("desc");
    act(() => result.current.list.setPage(2));
    act(() => result.current.list.setPageSize(50));
    expect(result.current.list.page).toBe(1);
    expect(result.current.list.pageSize).toBe(50);
  });

  it("writes canonical URLs — defaults are removed, unrelated params preserved", () => {
    const { result } = renderHook(() => useProbe(CONFIG), {
      wrapper: wrap("/components?tab=map&page=2&provider=AWS&gone=hide"),
    });
    // gone=hide is the filter default → canonical URL drops it on next write.
    act(() => result.current.list.setFilter("gone", "hide"));
    expect(result.current.search).not.toContain("gone=");
    expect(result.current.search).toContain("tab=map");
    // provider back to "all" → param removed.
    act(() => result.current.list.setFilter("provider", "all"));
    expect(result.current.search).not.toContain("provider=");
    // page back to 1 → param removed.
    act(() => result.current.list.setPage(1));
    expect(result.current.search).not.toContain("page=");
  });

  it("setFilter coerces invalid values to the filter default", () => {
    const { result } = renderHook(() => useProbe(CONFIG), { wrapper: wrap("/components") });
    act(() => result.current.list.setFilter("provider", "BOGUS"));
    expect(result.current.list.filters.provider).toBe("all");
    expect(result.current.search).not.toContain("provider=");
  });

  it("validates CSV filters through isValid", () => {
    const { result } = renderHook(() => useProbe(CONFIG), {
      wrapper: wrap("/components?status=RUNNING,ERROR"),
    });
    expect(result.current.list.filters.status).toBe("RUNNING,ERROR");
    act(() => result.current.list.setFilter("status", "RUNNING,BOGUS"));
    expect(result.current.list.filters.status).toBe("");
  });

  it("composes multiple setter calls in one tick (Clear scenario)", () => {
    const { result } = renderHook(() => useProbe(CONFIG), {
      wrapper: wrap("/components?page=2&q=redis&provider=AWS&gone=show&tab=map"),
    });
    // ListToolbar Clear fires onQueryChange + every filter onChange in one
    // handler — all writes must land, not just the last.
    act(() => {
      result.current.list.setSearch("");
      result.current.list.setFilter("provider", "all");
      result.current.list.setFilter("gone", "hide");
      result.current.list.setFilter("status", "");
    });
    expect(result.current.search).toBe("?tab=map");
    expect(result.current.list.filters).toEqual({ provider: "all", gone: "hide", status: "" });
  });

  it("reset clears managed params but preserves unrelated ones", () => {
    const { result } = renderHook(() => useProbe(CONFIG), {
      wrapper: wrap("/components?page=2&size=100&sort=lastSeenAt&order=desc&q=x&provider=AWS&tab=map"),
    });
    act(() => result.current.list.reset());
    expect(result.current.search).toBe("?tab=map");
    expect(result.current.list.page).toBe(1);
    expect(result.current.list.pageSize).toBe(25);
    expect(result.current.list.sort).toBe("name");
  });

  it("setSort(null) returns to the default sort", () => {
    const { result } = renderHook(() => useProbe(CONFIG), {
      wrapper: wrap("/components?sort=lastSeenAt"),
    });
    act(() => result.current.list.setSort(null));
    expect(result.current.list.sort).toBe("name");
    expect(result.current.search).not.toContain("sort=");
  });
});

describe("useClampPage (spec 068 review T064)", () => {
  it("rewrites an out-of-range ?page= to pageCount once data resolves", () => {
    const setPage = vi.fn();
    renderHook(() => useClampPage({ page: 9, setPage }, { total: 60, pageCount: 3 }));
    expect(setPage).toHaveBeenCalledTimes(1);
    expect(setPage).toHaveBeenCalledWith(3);
  });

  it("leaves an in-range page alone and never fires while unresolved", () => {
    const setPage = vi.fn();
    const { rerender } = renderHook(
      ({ page, pagination }: { page: number; pagination?: { total: number; pageCount: number } }) =>
        useClampPage({ page, setPage }, pagination),
      {
        initialProps: {
          page: 2,
          pagination: undefined as { total: number; pageCount: number } | undefined,
        },
      },
    );
    expect(setPage).not.toHaveBeenCalled();
    rerender({ page: 2, pagination: { total: 60, pageCount: 3 } });
    expect(setPage).not.toHaveBeenCalled();
    rerender({ page: 4, pagination: { total: 60, pageCount: 3 } });
    expect(setPage).toHaveBeenCalledWith(3);
  });

  it("resets page to 1 on an empty result set and cannot loop", () => {
    const setPage = vi.fn();
    renderHook(() => useClampPage({ page: 5, setPage }, { total: 0, pageCount: 0 }));
    expect(setPage).toHaveBeenCalledWith(1);
    // page 1 is a fixed point — re-rendering with the corrected page is a no-op.
    setPage.mockClear();
    renderHook(() => useClampPage({ page: 1, setPage }, { total: 0, pageCount: 0 }));
    expect(setPage).not.toHaveBeenCalled();
  });

  it("canonicalizes the URL through useListState — ?page=999 becomes ?page=3", () => {
    function Probe() {
      const list = useListState({ sortKeys: ["name"] as const });
      const { search } = useLocation();
      // Simulates the resolved server envelope for a 60-row list.
      useClampPage(list, { total: 60, pageCount: 3 });
      return (
        <>
          <span data-testid="page">{list.page}</span>
          <span data-testid="search">{search}</span>
        </>
      );
    }
    render(
      <MemoryRouter initialEntries={["/components?page=999&provider=AWS"]}>
        <Probe />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("page").textContent).toBe("3");
    // The page param is rewritten in place; unrelated params are preserved.
    expect(screen.getByTestId("search").textContent).toBe("?page=3&provider=AWS");
  });
});

describe("buildListQueryString", () => {
  it("maps state to API param names and skips defaults", () => {
    const qs = buildListQueryString({
      page: 2,
      pageSize: 50,
      sort: "name",
      order: "desc",
      search: "redis",
      filters: { provider: "AWS", gone: "hide" },
      defaults: {
        page: 1,
        pageSize: 25,
        sort: "name",
        order: "asc",
        search: "",
        filters: { provider: "all", gone: "hide" },
      },
    });
    const params = new URLSearchParams(qs);
    expect(params.get("page")).toBe("2");
    expect(params.get("pageSize")).toBe("50");
    // sort=name equals default → omitted; order=desc kept.
    expect(params.get("sort")).toBeNull();
    expect(params.get("order")).toBe("desc");
    expect(params.get("search")).toBe("redis");
    expect(params.get("provider")).toBe("AWS");
    expect(params.get("gone")).toBeNull(); // equals its default
  });

  it("returns empty string when everything is default", () => {
    expect(
      buildListQueryString({
        page: 1,
        pageSize: 25,
        sort: null,
        order: "asc",
        search: "",
        filters: {},
      }),
    ).toBe("");
  });
});

describe("useDebouncedValue", () => {
  it("returns the value only after the delay elapses", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), {
      initialProps: { v: "a" },
    });
    expect(result.current).toBe("a");
    rerender({ v: "ab" });
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe("a");
    act(() => vi.advanceTimersByTime(150));
    expect(result.current).toBe("ab");
  });
});

describe("ListToolbar emptyValue (spec 068 gone-filter fix)", () => {
  const goneFilter = (value: string, onChange = vi.fn()): FilterDef => ({
    id: "gone",
    label: "Gone instances",
    value,
    onChange,
    emptyValue: "hide",
    options: [
      { value: "hide", label: "Hidden" },
      { value: "show", label: "Shown" },
    ],
  });

  const openFilter = (label: string) => {
    const trigger = screen.getByRole("combobox", { name: label });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    return Array.from(document.querySelectorAll('[data-slot="select-item"]')).map(
      (el) => el.textContent,
    );
  };

  it("renders no 'All' option for a custom emptyValue filter", () => {
    render(
      <MemoryRouter>
        <ListToolbar query="" onQueryChange={() => {}} resultCount={1} total={1} filters={[goneFilter("hide")]} />
      </MemoryRouter>,
    );
    const items = openFilter("Gone instances");
    expect(items).toEqual(["Hidden", "Shown"]);
  });

  it("keeps 'All' for default emptyValue filters", () => {
    render(
      <MemoryRouter>
        <ListToolbar
          query=""
          onQueryChange={() => {}}
          resultCount={1}
          total={1}
          filters={[{ id: "p", label: "Provider", value: "all", onChange: () => {}, options: [{ value: "GITHUB", label: "GitHub" }] }]}
        />
      </MemoryRouter>,
    );
    const items = openFilter("Provider");
    expect(items).toEqual(["All", "GitHub"]);
  });

  it("does not show Clear when the only filter sits at its emptyValue", () => {
    render(
      <MemoryRouter>
        <ListToolbar query="" onQueryChange={() => {}} resultCount={1} total={1} filters={[goneFilter("hide")]} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("shows Clear when a custom-emptyValue filter is non-default, and Clear restores emptyValue", () => {
    const onChange = vi.fn();
    const onQueryChange = vi.fn();
    render(
      <MemoryRouter>
        <ListToolbar
          query=""
          onQueryChange={onQueryChange}
          resultCount={1}
          total={1}
          filters={[goneFilter("show", onChange)]}
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onQueryChange).toHaveBeenCalledWith("");
    expect(onChange).toHaveBeenCalledWith("hide");
  });
});

describe("ListPagination", () => {
  it("renders the row range, page window, and 25/50/100 selector", () => {
    render(
      <ListPagination page={2} pageSize={25} total={108} pageCount={5} onPageChange={() => {}} onPageSizeChange={() => {}} />,
    );
    expect(screen.getByText("26–50 of 108")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Page 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Page 5" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Rows per page" })).toBeTruthy();
  });

  it("compacts the page window with ellipses for large page counts", () => {
    const { container } = render(
      <ListPagination page={20} pageSize={25} total={1000} pageCount={40} onPageChange={() => {}} onPageSizeChange={() => {}} />,
    );
    expect(screen.getByRole("button", { name: "Page 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Page 19" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Page 20" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Page 21" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Page 40" })).toBeTruthy();
    expect(container.querySelectorAll('[data-slot="pagination-ellipsis"]').length).toBe(2);
  });

  it("disables prev/next at the bounds and reports page changes", () => {
    const onPageChange = vi.fn();
    render(
      <ListPagination page={1} pageSize={25} total={30} pageCount={2} onPageChange={onPageChange} onPageSizeChange={() => {}} />,
    );
    expect((screen.getByRole("button", { name: "Go to previous page" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Page 2" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
    fireEvent.click(screen.getByRole("button", { name: "Go to next page" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("shows '0 results' for an empty list", () => {
    render(
      <ListPagination page={1} pageSize={25} total={0} pageCount={0} onPageChange={() => {}} onPageSizeChange={() => {}} />,
    );
    expect(screen.getByText("0 results")).toBeTruthy();
  });
});

describe("SortableTableHead", () => {
  const head = (sort: string | null, order: "asc" | "desc", onSortChange = vi.fn()) => (
    <MemoryRouter>
      <Table>
        <TableHeader>
          <TableRow>
            <SortableTableHead sortKey="name" sort={sort} order={order} onSortChange={onSortChange}>
              Name
            </SortableTableHead>
            <TableHead>Other</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>x</TableCell>
            <TableCell>y</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </MemoryRouter>
  );

  it("cycles inactive → asc → desc → cleared and reflects aria-sort", () => {
    const onSortChange = vi.fn();
    const { container, rerender } = render(head(null, "asc", onSortChange));
    const th = container.querySelector("th")!;
    expect(th.getAttribute("aria-sort")).toBe("none");

    fireEvent.click(screen.getByRole("button", { name: /name/i }));
    expect(onSortChange).toHaveBeenLastCalledWith("name", "asc");

    rerender(head("name", "asc", onSortChange));
    expect(th.getAttribute("aria-sort")).toBe("ascending");
    fireEvent.click(screen.getByRole("button", { name: /name/i }));
    expect(onSortChange).toHaveBeenLastCalledWith("name", "desc");

    rerender(head("name", "desc", onSortChange));
    expect(th.getAttribute("aria-sort")).toBe("descending");
    fireEvent.click(screen.getByRole("button", { name: /name/i }));
    expect(onSortChange).toHaveBeenLastCalledWith(null, "desc");
  });
});

describe("TitleWithSummary / SUMMARY_FIELDS", () => {
  const component: Component = {
    id: "c1",
    name: "billing-api",
    slug: "billing-api",
    category: "API",
    provider: "GITHUB",
    resourceType: "service",
    lifecycle: "ACTIVE",
    componentGroupId: null,
    componentGroupName: null,
    teamOwnerId: null,
    teamOwnerName: "Payments",
    tags: ["billing", "core"],
    sunsetAt: null,
    links: [],
    instanceCount: 3,
    instances: [],
    lastSeenAt: null,
    worstStatus: "RUNNING",
    details: { secret: "should-never-render", nested: { token: "x" } },
  };

  it("component summary covers the curated allowlist — never details/secrets", () => {
    const fields = summaryFieldsFor("component", component);
    const labels = fields.map((f) => f.label);
    for (const expected of [
      "Provider", "Category", "Resource type", "Owner", "Group",
      "Lifecycle", "Instances", "Health", "Last seen", "Tags",
    ]) {
      expect(labels).toContain(expected);
    }
    const rendered = JSON.stringify(fields, (_k, v) => (typeof v === "object" && v !== null && "$$typeof" in v ? "[react]" : v));
    expect(rendered).not.toContain("should-never-render");
    expect(labels).not.toContain("details");
    expect(labels).not.toContain("secrets");
  });

  it("renders the title with a title-attribute fallback and no card when summary is absent", () => {
    render(
      <TitleWithSummary title="billing-api" titleText="billing-api" />,
    );
    const el = screen.getByText("billing-api");
    expect(el.getAttribute("title")).toBe("billing-api");
  });

  it("renders title + registry summary without throwing", () => {
    render(
      <TitleWithSummary title="billing-api" titleText="billing-api" summary={{ kind: "component", row: component }} />,
    );
    expect(screen.getByText("billing-api")).toBeTruthy();
  });

  it("every registry extractor returns fields for its kind", () => {
    // Smoke: all kinds are wired (per-kind fixtures live with page tests).
    expect(Object.keys(SUMMARY_FIELDS).sort()).toEqual(
      [
        "agent", "audit", "component", "componentGroup", "credential",
        "edgeSuggestion", "generic", "importRun", "importerConfig",
        "importerSource", "lob", "product", "team", "user",
      ].sort(),
    );
  });

  it("generic fallback emits only present fields; empty row yields no card", () => {
    expect(summaryFieldsFor("generic", { name: "x", slug: "x-1" }).map((f) => f.label)).toEqual([
      "Name",
      "Slug",
    ]);
    expect(summaryFieldsFor("generic", {})).toEqual([]);
  });
});
