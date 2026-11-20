import * as React from "react"
import { ChevronRightIcon, RefreshCwIcon } from "lucide-react"
import type { Paginated } from "@componode/core"
import { Button } from "@/ux/components/ui/button"
import { Spinner } from "@/ux/components/ui/spinner"
import { Table, TableBody, TableCell, TableRow } from "@/ux/components/ui/table"
import { cn } from "@/ux/lib/utils"

/**
 * Accessible lazy tree grid (spec 073, UX-A11Y-01 / UX-BOM-12). Renders a
 * WAI-ARIA `treegrid`: expandable rows load direct children on demand at
 * 50 per page, a "Show 50 more" row pages further, and a failed fetch
 * yields an inline retry row — never a page-level error.
 *
 * Keyboard model: ↑/↓ move between visible rows, → expands a closed row
 * (or moves into it), ← collapses (or moves to the parent), Home/End jump
 * to the first/last visible row. Roving tabindex keeps one row tabbable.
 * Expansion state is client-only — never in the URL.
 */

export interface TreeGridRowCtx {
  /** 1-based depth — top-level rows are level 1. */
  level: number;
  expandable: boolean;
  expanded: boolean;
  toggle: () => void;
  posInSet: number;
  setSize: number;
}

interface ExpandableRow {
  id: string;
  hasChildren: boolean;
  childCount: number;
}

interface ChildrenState<T> {
  rows: T[];
  page: number;
  hasNext: boolean;
  loading: boolean;
  error: boolean;
}

interface TreeGridProps<T extends ExpandableRow> {
  ariaLabel: string;
  /** TableHeader block — the grid renders `<Table>` around it. */
  head: React.ReactNode;
  rows: T[];
  /** Column count for loader / "Show more" / retry rows. */
  colSpan: number;
  loadChildren: (parentId: string, page: number) => Promise<Paginated<T>>;
  /** Row cells — rendered inside a treegrid `<tr>` managed by the grid. */
  renderRow: (row: T, ctx: TreeGridRowCtx) => React.ReactNode;
}

interface FlatRow {
  id: string;
  parentId: string | null;
  level: number;
}

export function TreeGrid<T extends ExpandableRow>({
  ariaLabel,
  head,
  rows,
  colSpan,
  loadChildren,
  renderRow,
}: TreeGridProps<T>) {
  const [expanded, setExpanded] = React.useState<Map<string, ChildrenState<T>>>(new Map());
  const rowRefs = React.useRef(new Map<string, HTMLTableRowElement>());
  const [focusId, setFocusId] = React.useState<string | null>(null);

  const load = React.useCallback(
    async (parentId: string, page: number) => {
      setExpanded((prev) => {
        const next = new Map(prev);
        const cur = next.get(parentId);
        next.set(parentId, {
          rows: cur?.rows ?? [],
          page,
          hasNext: cur?.hasNext ?? false,
          loading: true,
          error: false,
        });
        return next;
      });
      try {
        const res = await loadChildren(parentId, page);
        setExpanded((prev) => {
          const next = new Map(prev);
          const cur = next.get(parentId);
          next.set(parentId, {
            rows: page === 1 ? res.data : [...(cur?.rows ?? []), ...res.data],
            page,
            hasNext: res.pagination?.hasNext ?? false,
            loading: false,
            error: false,
          });
          return next;
        });
      } catch {
        setExpanded((prev) => {
          const next = new Map(prev);
          const cur = next.get(parentId);
          next.set(parentId, {
            rows: cur?.rows ?? [],
            page,
            hasNext: cur?.hasNext ?? false,
            loading: false,
            error: true,
          });
          return next;
        });
      }
    },
    [loadChildren],
  );

  const toggle = React.useCallback(
    (row: T) => {
      const state = expanded.get(row.id);
      if (state && !state.error && (state.rows.length > 0 || state.loading)) {
        // Collapse — drop the cached children so re-expanding refetches fresh.
        setExpanded((prev) => {
          const next = new Map(prev);
          next.delete(row.id);
          return next;
        });
      } else {
        void load(row.id, 1);
      }
    },
    [expanded, load],
  );

  // Flattened visible-row order for the keyboard model.
  const flat = React.useMemo(() => {
    const out: FlatRow[] = [];
    const walk = (list: T[], level: number, parentId: string | null) => {
      for (const r of list) {
        out.push({ id: r.id, parentId, level });
        const st = expanded.get(r.id);
        if (st && st.rows.length > 0) walk(st.rows, level + 1, r.id);
      }
    };
    walk(rows, 1, null);
    return out;
  }, [rows, expanded]);

  const focusRow = React.useCallback((id: string) => {
    setFocusId(id);
    rowRefs.current.get(id)?.focus();
  }, []);

  const onRowKeyDown = (row: T, parentId: string | null) => (e: React.KeyboardEvent) => {
    const idx = flat.findIndex((f) => f.id === row.id);
    const state = expanded.get(row.id);
    const isOpen = !!state && (state.rows.length > 0 || state.loading);
    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        const next = flat[idx + 1];
        if (idx >= 0 && next) focusRow(next.id);
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        const prev = flat[idx - 1];
        if (idx > 0 && prev) focusRow(prev.id);
        break;
      }
      case "ArrowRight": {
        e.preventDefault();
        const next = flat[idx + 1];
        if (row.hasChildren && !isOpen) toggle(row);
        else if (isOpen && next) focusRow(next.id);
        break;
      }
      case "ArrowLeft":
        e.preventDefault();
        if (isOpen) toggle(row);
        else if (parentId) focusRow(parentId);
        break;
      case "Home": {
        e.preventDefault();
        const first = flat[0];
        if (first) focusRow(first.id);
        break;
      }
      case "End": {
        e.preventDefault();
        const last = flat[flat.length - 1];
        if (last) focusRow(last.id);
        break;
      }
      default:
        break;
    }
  };

  const renderLevel = (list: T[], level: number, parentId: string | null): React.ReactNode =>
    list.map((row, i) => {
      const state = expanded.get(row.id);
      const isOpen = !!state && (state.rows.length > 0 || state.loading || state.error);
      const setSize = list.length;
      const ctx: TreeGridRowCtx = {
        level,
        expandable: row.hasChildren,
        expanded: isOpen,
        toggle: () => toggle(row),
        posInSet: i + 1,
        setSize,
      };
      return (
        <React.Fragment key={row.id}>
          <TableRow
            role="row"
            aria-level={level}
            aria-posinset={i + 1}
            aria-setsize={setSize}
            aria-expanded={row.hasChildren ? isOpen : undefined}
            tabIndex={focusId === null ? (flat[0]?.id === row.id ? 0 : -1) : focusId === row.id ? 0 : -1}
            ref={(el) => {
              if (el) rowRefs.current.set(row.id, el);
              else rowRefs.current.delete(row.id);
            }}
            onKeyDown={onRowKeyDown(row, parentId)}
            onFocus={() => setFocusId(row.id)}
          >
            {renderRow(row, ctx)}
          </TableRow>
          {isOpen ? renderLevel(state.rows, level + 1, row.id) : null}
          {isOpen && state.loading ? (
            <TableRow role="row" aria-level={level + 1} className="hover:bg-transparent">
              <TableCell colSpan={colSpan} className="py-3">
                <span className="inline-flex items-center gap-2 text-sm text-muted-foreground" style={{ paddingLeft: `${level * 24}px` }}>
                  <Spinner className="size-3.5" /> Loading children…
                </span>
              </TableCell>
            </TableRow>
          ) : null}
          {isOpen && state.error ? (
            <TableRow role="row" aria-level={level + 1} className="hover:bg-transparent">
              <TableCell colSpan={colSpan} className="py-3">
                <span className="inline-flex items-center gap-2" style={{ paddingLeft: `${level * 24}px` }}>
                  <span className="text-sm text-muted-foreground">Couldn't load children.</span>
                  <Button variant="outline" size="sm" onClick={() => void load(row.id, 1)}>
                    <RefreshCwIcon data-icon="inline-start" /> Retry
                  </Button>
                </span>
              </TableCell>
            </TableRow>
          ) : null}
          {isOpen && !state.loading && !state.error && state.hasNext ? (
            <TableRow role="row" aria-level={level + 1} className="hover:bg-transparent">
              <TableCell colSpan={colSpan} className="py-2">
                <Button
                  variant="ghost"
                  size="sm"
                  style={{ marginLeft: `${level * 24}px` }}
                  onClick={() => void load(row.id, state.page + 1)}
                >
                  Show 50 more
                </Button>
              </TableCell>
            </TableRow>
          ) : null}
        </React.Fragment>
      );
    });

  return (
    <Table role="treegrid" aria-label={ariaLabel}>
      {head}
      <TableBody>{renderLevel(rows, 1, null)}</TableBody>
    </Table>
  );
}

/** Disclosure chevron cell content — the owning row decides placement. */
export function TreeDisclosure({ ctx, className }: { ctx: TreeGridRowCtx; className?: string }) {
  if (!ctx.expandable) {
    return <span className="inline-block size-5" aria-hidden="true" />;
  }
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      className={className}
      aria-label={ctx.expanded ? "Collapse row" : `Expand row — ${ctx.posInSet} of ${ctx.setSize}`}
      aria-expanded={ctx.expanded}
      onClick={(e) => {
        e.stopPropagation();
        ctx.toggle();
      }}
      tabIndex={-1}
    >
      <ChevronRightIcon className={cn("size-4 transition-transform", ctx.expanded && "rotate-90")} aria-hidden="true" />
    </Button>
  );
}
