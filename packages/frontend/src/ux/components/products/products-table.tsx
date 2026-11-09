import { PackageIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { useNavigate } from "react-router-dom"
import type { PaginationMeta } from "@/api/types"
import type { ProductsFilterKey, ProductsSortKey } from "@/api/hooks/products"
import { CompletenessIndicator } from "@/ux/components/patterns/completeness"
import { ListPagination } from "@/ux/components/patterns/list-pagination"
import { ListToolbar } from "@/ux/components/patterns/list-toolbar"
import { RelativeTime } from "@/ux/components/patterns/primitives"
import { EmptyState } from "@/ux/components/patterns/states"
import { SortableTableHead } from "@/ux/components/patterns/sortable-header"
import { CriticalityBadge, HealthBadge, LifecycleBadge, ProductTypeBadge } from "@/ux/components/patterns/status-badge"
import { TitleWithSummary } from "@/ux/components/patterns/title-with-summary"
import { Button } from "@/ux/components/ui/button"
import { Card } from "@/ux/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table"
import type { ListState } from "@/ux/hooks/use-list-state"
import { useListSearch } from "@/ux/hooks/use-list-search"
import { CRITICALITY_META, LIFECYCLE_META, PRODUCT_TYPE_META } from "@/ux/lib/domain"
import { ux } from "@/ux/lib/paths"
import type { Product } from "@/ux/lib/view-types"

const toOptions = (meta: Record<string, { label: string }>) => Object.entries(meta).map(([value, m]) => ({ value, label: m.label }))

/**
 * Server-paginated products table (spec 068). Filtering, sorting, search,
 * and paging are URL-backed via `useListState`; health, component count,
 * and completeness are app-computed so their headers carry no sort
 * affordance (contract: not in the sort whitelist).
 */
export function ProductsTable({
  data,
  list,
  pagination,
}: {
  data: Product[]
  list: ListState<ProductsSortKey, ProductsFilterKey>
  pagination?: PaginationMeta
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useListSearch(list)
  const total = pagination?.total ?? data.length

  const sortProps = {
    sort: list.sort,
    order: list.order,
    onSortChange: (sort: string | null, order: "asc" | "desc") =>
      list.setSort((sort as ProductsSortKey | null) ?? null, order),
  }

  return (
    <div className="flex flex-col gap-4">
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search products, teams, tags"
        resultCount={data.length}
        total={total}
        filters={[
          { id: "type", label: "Type", value: list.filters.type, onChange: (v) => list.setFilter("type", v), options: toOptions(PRODUCT_TYPE_META) },
          { id: "crit", label: "Criticality", value: list.filters.criticality, onChange: (v) => list.setFilter("criticality", v), options: toOptions(CRITICALITY_META) },
          {
            // Default is ACTIVE (not "all") — the page hides retired products
            // unless asked, so the filter's unset sentinel is "ACTIVE".
            id: "life",
            label: "Lifecycle",
            value: list.filters.lifecycle,
            onChange: (v) => list.setFilter("lifecycle", v),
            emptyValue: "ACTIVE",
            options: [
              { value: "all", label: "All" },
              ...toOptions(LIFECYCLE_META),
            ],
          },
          {
            id: "missing",
            label: "Completeness",
            value: list.filters.missing,
            onChange: (v) => list.setFilter("missing", v),
            options: [
              { value: "incomplete", label: "Incomplete" },
              { value: "owner", label: "Missing owner" },
              { value: "description", label: "Missing description" },
              { value: "dependencies", label: "Missing dependencies" },
            ],
          },
        ]}
      />
      <Card className="overflow-hidden py-0">
        {data.length === 0 ? (
          <EmptyState
            icon={PackageIcon}
            title="No products match"
            description="Try a different search or clear the filters."
            className="border-0"
            action={
              <Button variant="outline" onClick={list.reset}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <SortableTableHead sortKey="name" {...sortProps} className="pl-4">Product</SortableTableHead>
                <SortableTableHead sortKey="type" {...sortProps}>Type</SortableTableHead>
                <SortableTableHead sortKey="owner" {...sortProps}>Owner</SortableTableHead>
                <SortableTableHead sortKey="criticality" {...sortProps}>Criticality</SortableTableHead>
                <TableHead>Health</TableHead>
                <TableHead className="text-right">Components</TableHead>
                <TableHead>Completeness</TableHead>
                <SortableTableHead sortKey="updated" {...sortProps} className="pr-4 text-right">Updated</SortableTableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((p) => (
                <TableRow
                  key={p.id}
                  className="cursor-pointer"
                  onClick={(e) => {
                    if ((e.target as HTMLElement).closest("a,button")) return
                    navigate(ux(`/products/${p.slug}`))
                  }}
                >
                  <TableCell className="pl-4">
                    <div className="flex min-w-0 flex-col">
                      <TitleWithSummary
                        title={
                          <Link to={ux(`/products/${p.slug}`)} className="block truncate font-medium underline-offset-4 hover:underline">
                            {p.name}
                          </Link>
                        }
                        titleText={p.name}
                        summary={{ kind: "product", row: p }}
                      />
                      <span className="max-w-72 truncate text-xs text-muted-foreground">{p.description ?? "No description"}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <ProductTypeBadge value={p.type} />
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col text-sm">
                      <span>{p.teamOwnerName ?? <span className="text-muted-foreground">Unowned</span>}</span>
                      <span className="text-xs text-muted-foreground">{p.lobOwnerName}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <CriticalityBadge value={p.criticality} />
                  </TableCell>
                  <TableCell>
                    {p.lifecycle === "RETIRED" ? <LifecycleBadge value="RETIRED" /> : <HealthBadge value={p.status} />}
                  </TableCell>
                  <TableCell className="tabular text-right">{p.componentCount}</TableCell>
                  <TableCell>
                    <CompletenessIndicator value={p.completeness} />
                  </TableCell>
                  <TableCell className="pr-4 text-right text-sm text-muted-foreground">
                    <RelativeTime iso={p.updatedAt} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {pagination && (
        <ListPagination
          page={list.page}
          pageSize={list.pageSize}
          total={pagination.total}
          pageCount={pagination.pageCount}
          onPageChange={list.setPage}
          onPageSizeChange={list.setPageSize}
        />
      )}
    </div>
  )
}
