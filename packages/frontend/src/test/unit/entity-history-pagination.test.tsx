import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import { EntityHistory } from "@/ux/components/patterns/entity-history";
import { usePagedActivityFeed, usePagedEntityHistory } from "@/ux/hooks/use-entity-history";
import { useActivityFeed, useEntityHistory } from "@/api/hooks/audit";
import type { AuditEvent } from "@/ux/lib/view-types";

/**
 * Spec 068 review T065 — entity history must be genuinely paginated: the
 * audit hooks accept page/pageSize, the pager callbacks drive the next
 * query, and `EntityHistory` renders the standard ListPagination.
 */

vi.mock("@/api/hooks/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/hooks/audit")>();
  return {
    ...actual,
    useEntityHistory: vi.fn(),
    useActivityFeed: vi.fn(),
  };
});

const feed = (over: Record<string, unknown> = {}) => ({
  data: {
    items: [],
    total: 60,
    page: 1,
    pageSize: 25,
    pageCount: 3,
    hasNext: true,
    ...over,
  },
  isPending: false,
  error: null,
});

const event = (over: Partial<AuditEvent> = {}): AuditEvent => ({
  id: "e1",
  actor: "alice",
  action: "updated",
  entityKind: "component",
  entityName: "orders-db",
  summary: "Changed tags",
  at: "2026-11-01T10:00:00Z",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("usePagedEntityHistory", () => {
  it("queries page 1 / pageSize 25 / createdAt desc and exposes pager props", () => {
    vi.mocked(useEntityHistory).mockReturnValue(feed() as never);
    const { result } = renderHook(() => usePagedEntityHistory("component", "c1"));

    expect(useEntityHistory).toHaveBeenCalledWith("component", "c1", {
      page: 1,
      pageSize: 25,
      sort: "createdAt",
      order: "desc",
    });
    expect(result.current.pagination).toMatchObject({
      page: 1,
      pageSize: 25,
      total: 60,
      pageCount: 3,
    });
  });

  it("pager callbacks drive the next query — page change keeps pageSize, size change resets page", () => {
    vi.mocked(useEntityHistory).mockReturnValue(feed() as never);
    const { result } = renderHook(() => usePagedEntityHistory("component", "c1"));

    act(() => result.current.pagination!.onPageChange(2));
    expect(useEntityHistory).toHaveBeenLastCalledWith(
      "component",
      "c1",
      expect.objectContaining({ page: 2, pageSize: 25 }),
    );

    act(() => result.current.pagination!.onPageSizeChange(50));
    expect(useEntityHistory).toHaveBeenLastCalledWith(
      "component",
      "c1",
      expect.objectContaining({ page: 1, pageSize: 50 }),
    );
  });

  it("clamps an out-of-range page once the feed resolves", () => {
    vi.mocked(useEntityHistory).mockReturnValue(feed() as never);
    const { result, rerender } = renderHook(() => usePagedEntityHistory("component", "c1"));

    act(() => result.current.pagination!.onPageChange(3));
    expect(useEntityHistory).toHaveBeenLastCalledWith(
      "component",
      "c1",
      expect.objectContaining({ page: 3 }),
    );

    // The result set shrank — page 3 no longer exists.
    vi.mocked(useEntityHistory).mockReturnValue(
      feed({ total: 10, pageCount: 1, hasNext: false }) as never,
    );
    rerender();
    expect(useEntityHistory).toHaveBeenLastCalledWith(
      "component",
      "c1",
      expect.objectContaining({ page: 1 }),
    );
  });

  it("returns no pagination while data is unresolved or empty", () => {
    vi.mocked(useEntityHistory).mockReturnValue({ data: undefined, isPending: true, error: null } as never);
    const { result, rerender } = renderHook(() => usePagedEntityHistory("component", "c1"));
    expect(result.current.pagination).toBeUndefined();

    vi.mocked(useEntityHistory).mockReturnValue(
      feed({ items: [], total: 0, pageCount: 0, hasNext: false }) as never,
    );
    rerender();
    expect(result.current.pagination).toBeUndefined();
  });
});

describe("usePagedActivityFeed", () => {
  it("forwards feed filters and pins createdAt desc paging", () => {
    vi.mocked(useActivityFeed).mockReturnValue(feed({ total: 5, pageCount: 1, hasNext: false }) as never);
    renderHook(() => usePagedActivityFeed({ actor: "bob", kind: "entity" }));

    expect(useActivityFeed).toHaveBeenCalledWith({
      actor: "bob",
      kind: "entity",
      page: 1,
      pageSize: 25,
      sort: "createdAt",
      order: "desc",
    });
  });
});

describe("EntityHistory pager", () => {
  const wrap = (el: ReactElement) =>
    render(<TooltipProvider>{el}</TooltipProvider>);

  it("renders the standard pager and reports page/size changes", () => {
    const onPageChange = vi.fn();
    const onPageSizeChange = vi.fn();
    wrap(
      <EntityHistory
        events={[event()]}
        entityLabel="component"
        pagination={{
          page: 2,
          pageSize: 25,
          total: 60,
          pageCount: 3,
          onPageChange,
          onPageSizeChange,
        }}
      />,
    );

    expect(screen.getByText("26–50 of 60")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Page 3" }));
    expect(onPageChange).toHaveBeenCalledWith(3);
    expect(screen.getByRole("combobox", { name: "Rows per page" })).toBeTruthy();
  });

  it("renders no pager without pagination props (legacy callers)", () => {
    wrap(<EntityHistory events={[event()]} entityLabel="component" />);
    expect(screen.queryByRole("combobox", { name: "Rows per page" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Go to next page" })).toBeNull();
  });

  it("keeps the empty state when there are no events and no pager", () => {
    wrap(<EntityHistory events={[]} entityLabel="component" />);
    expect(screen.getByText("No recorded changes")).toBeTruthy();
  });
});
