import type { ListSortOrder } from "@/api/list-query"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/ux/components/ui/select"
import { cn } from "@/ux/lib/utils"

export interface ListSortOption<S extends string = string> {
  /** Sort key sent to the API — must be in the endpoint's sort whitelist. */
  sort: S
  order: ListSortOrder
  /** Option label, e.g. "Name", "Newest first". */
  label: string
}

export interface ListSortSelectProps<S extends string = string> {
  /** Currently applied sort (resolved); null when the list is unsorted. */
  sort: S | null
  /** Current sort direction. */
  order: ListSortOrder
  /**
   * Called with the chosen (sort, order) pair. A select always commits a
   * concrete option — there is no "clear" affordance; pages that support
   * unsorted lists should include an explicit option for it.
   */
  onSortChange: (sort: S, order: ListSortOrder) => void
  /**
   * The offered (sort, order) combinations. Should cover every reachable
   * state — including the page's default — so the trigger always resolves
   * to a labelled option.
   */
  options: ListSortOption<S>[]
  className?: string
}

const encode = (sort: string, order: string) => `${sort}:${order}`

/**
 * Sort picker for card-grid and other non-tabular lists (spec 068 US2).
 * `SortableTableHead` covers tables; grids have no header row, so sort is
 * exposed as a single select whose options are concrete (sort, order)
 * pairs — e.g. lobs: Name / Name (Z–A) / Newest first / Oldest first.
 * Render it in `ListToolbar`'s `end` slot or beside the filters.
 */
export function ListSortSelect<S extends string = string>({
  sort,
  order,
  onSortChange,
  options,
  className,
}: ListSortSelectProps<S>) {
  const value = sort == null ? "" : encode(sort, order)
  const matched = options.some((o) => encode(o.sort, o.order) === value)

  return (
    <Select
      value={matched ? value : ""}
      onValueChange={(v) => {
        const sep = v.lastIndexOf(":")
        if (sep === -1) return
        onSortChange(v.slice(0, sep) as S, v.slice(sep + 1) as ListSortOrder)
      }}
    >
      <SelectTrigger size="sm" aria-label="Sort" className={cn("w-auto min-w-36", className)}>
        <span className="text-muted-foreground">Sort:</span>
        <SelectValue placeholder="Default" />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((o) => (
            <SelectItem key={encode(o.sort, o.order)} value={encode(o.sort, o.order)}>
              {o.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
