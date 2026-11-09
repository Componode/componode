import { ArrowDownIcon, ArrowUpIcon, ChevronsUpDownIcon } from "lucide-react"
import type * as React from "react"
import type { ListSortOrder } from "@/api/list-query"
import { TableHead } from "@/ux/components/ui/table"
import { cn } from "@/ux/lib/utils"

export interface SortableTableHeadProps
  extends Omit<React.ComponentProps<typeof TableHead>, "children" | "aria-sort"> {
  /** Sort key sent to the API — must be in the page's sort whitelist. */
  sortKey: string
  /** Currently applied sort (resolved); null when the list is unsorted. */
  sort: string | null
  /** Current sort direction. */
  order: ListSortOrder
  /**
   * Called with the next (sort, order). Cycle per click on this column:
   * inactive → ascending → descending → cleared (`sort: null`, back to the
   * list's default sort). Choosing a different column always starts
   * ascending.
   */
  onSortChange: (sort: string | null, order: ListSortOrder) => void
  children: React.ReactNode
}

/**
 * The three props a server-paginated table needs to wire its sortable
 * columns — spread onto the table component from the page's `useListState`
 * (`sort={state.sort} order={state.order} onSortChange={state.setSort}`).
 */
export interface ListSortBindings {
  sort: string | null
  order: ListSortOrder
  onSortChange: (sort: string | null, order: ListSortOrder) => void
}

/**
 * Sortable column header (spec 068 US2). Renders a `TableHead` containing
 * a real button — keyboard-focusable and activating on Enter/Space — with
 * `aria-sort` on the `th` ("ascending" | "descending" | "none") so screen
 * readers announce the column's sort state. Compose with the standard
 * `bg-muted/40` header row; unsortable (app-computed) columns keep using
 * plain `TableHead` with no affordance.
 */
export function SortableTableHead({
  sortKey,
  sort,
  order,
  onSortChange,
  children,
  className,
  ...props
}: SortableTableHeadProps) {
  const active = sort === sortKey
  const ariaSort = active ? (order === "asc" ? "ascending" : "descending") : "none"
  const Icon = active ? (order === "asc" ? ArrowUpIcon : ArrowDownIcon) : ChevronsUpDownIcon

  const handleClick = () => {
    if (!active) onSortChange(sortKey, "asc")
    else if (order === "asc") onSortChange(sortKey, "desc")
    else onSortChange(null, order)
  }

  return (
    <TableHead aria-sort={ariaSort} className={className} {...props}>
      <button
        type="button"
        onClick={handleClick}
        className="group/sort inline-flex cursor-pointer items-center gap-1 rounded-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {children}
        <Icon
          className={cn("size-3.5 shrink-0", active ? "text-foreground" : "text-muted-foreground group-hover/sort:text-foreground/70")}
          aria-hidden="true"
        />
      </button>
    </TableHead>
  )
}
