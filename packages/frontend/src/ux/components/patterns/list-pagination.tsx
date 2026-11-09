import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { LIST_PAGE_SIZE_OPTIONS } from "@/api/list-query"
import { Button } from "@/ux/components/ui/button"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
} from "@/ux/components/ui/pagination"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ux/components/ui/select"
import { formatNumber } from "@/ux/lib/format"
import { cn } from "@/ux/lib/utils"

export { LIST_PAGE_SIZE_OPTIONS }

export interface ListPaginationProps {
  /** 1-based current page (resolved — never below 1). */
  page: number
  pageSize: number
  /** Server-reported total rows matching the current filters. */
  total: number
  /** Server-reported page count for the current filters. */
  pageCount: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
  className?: string
}

type PageItem = number | "ellipsis"

/**
 * Compact page window: always the first and last page plus current ±1,
 * with ellipses for the gaps — bounded regardless of pageCount.
 */
function pageItems(page: number, pageCount: number): PageItem[] {
  if (pageCount <= 0) return []
  if (pageCount <= 7) {
    return Array.from({ length: pageCount }, (_, i) => i + 1)
  }
  const wanted = new Set<number>([1, pageCount, page - 1, page, page + 1])
  const sorted = [...wanted]
    .filter((p) => p >= 1 && p <= pageCount)
    .sort((a, b) => a - b)
  const items: PageItem[] = []
  let prev = 0
  for (const p of sorted) {
    if (prev !== 0 && p - prev > 1) items.push("ellipsis")
    items.push(p)
    prev = p
  }
  return items
}

/**
 * Footer pager for server-paginated lists (spec 068). Shows the current
 * row range ("26–50 of 108"), previous/next + a compact page-number
 * window, and the 25/50/100 rows-per-page selector. Pair it with
 * `ListToolbar`, which owns the "N results" count — this component shows
 * the page range instead of duplicating that total.
 */
export function ListPagination({
  page,
  pageSize,
  total,
  pageCount,
  onPageChange,
  onPageSizeChange,
  className,
}: ListPaginationProps) {
  // Clamp once so range text and the page window agree even when the
  // caller hands us a page outside [1, pageCount] (defensive — the hook
  // resolves page ≥ 1 and the API clamps to pageCount).
  const clampedPage = Math.min(Math.max(page, 1), Math.max(pageCount, 1))
  const start = total === 0 ? 0 : (clampedPage - 1) * pageSize + 1
  const end = Math.min(clampedPage * pageSize, total)
  const rangeText =
    total === 0
      ? "0 results"
      : `${formatNumber(start)}–${formatNumber(end)} of ${formatNumber(total)}`

  // Defensive: a pageSize outside the offered set still renders as an
  // option so the control never displays a value it can't represent.
  const sizeOptions: readonly number[] = (LIST_PAGE_SIZE_OPTIONS as readonly number[]).includes(pageSize)
    ? LIST_PAGE_SIZE_OPTIONS
    : [...LIST_PAGE_SIZE_OPTIONS, pageSize].sort((a, b) => a - b)

  const items = pageItems(clampedPage, pageCount)

  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", className)}>
      <div className="flex items-center gap-3">
        <p className="tabular text-sm text-muted-foreground" aria-live="polite">
          {rangeText}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Rows per page</span>
          <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
            <SelectTrigger size="sm" aria-label="Rows per page" className="w-auto min-w-14">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {sizeOptions.map((size) => (
                  <SelectItem key={size} value={String(size)}>
                    {size}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
      </div>
      <Pagination className="mx-0 w-auto justify-start self-start sm:self-auto">
        <PaginationContent>
          <PaginationItem>
            <Button
              variant="ghost"
              size="default"
              disabled={clampedPage <= 1}
              onClick={() => onPageChange(clampedPage - 1)}
              aria-label="Go to previous page"
            >
              <ChevronLeftIcon data-icon="inline-start" />
              <span className="hidden sm:block">Previous</span>
            </Button>
          </PaginationItem>
          {items.map((item, i) =>
            item === "ellipsis" ? (
              <PaginationItem key={`ellipsis-${i}`}>
                <PaginationEllipsis />
              </PaginationItem>
            ) : (
              <PaginationItem key={item}>
                <Button
                  variant={item === clampedPage ? "outline" : "ghost"}
                  size="icon"
                  aria-current={item === clampedPage ? "page" : undefined}
                  aria-label={`Page ${item}`}
                  onClick={() => onPageChange(item)}
                >
                  {item}
                </Button>
              </PaginationItem>
            ),
          )}
          <PaginationItem>
            <Button
              variant="ghost"
              size="default"
              disabled={clampedPage >= pageCount}
              onClick={() => onPageChange(clampedPage + 1)}
              aria-label="Go to next page"
            >
              <span className="hidden sm:block">Next</span>
              <ChevronRightIcon data-icon="inline-end" />
            </Button>
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  )
}
