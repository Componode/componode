import { flags } from "@/ux/lib/flags";
import { ux } from "@/ux/lib/paths";
import { Link } from "react-router-dom"
import type { PaginationMeta } from "@/api/types";
import type { ComponentsFilterKey, ComponentsSortKey } from "@/api/hooks/components";
import { ListPagination } from "@/ux/components/patterns/list-pagination"
import { ListToolbar } from "@/ux/components/patterns/list-toolbar"
import { RelativeTime } from "@/ux/components/patterns/primitives"
import { ProviderMark } from "@/ux/components/patterns/provider-mark"
import { SortableTableHead } from "@/ux/components/patterns/sortable-header"
import { EmptyState } from "@/ux/components/patterns/states"
import { HealthBadge, LifecycleBadge } from "@/ux/components/patterns/status-badge"
import { TitleWithSummary } from "@/ux/components/patterns/title-with-summary"
import { Card } from "@/ux/components/ui/card"
import { Table, TableBody, TableCell, TableHeader, TableRow } from "@/ux/components/ui/table"
import type { ListState } from "@/ux/hooks/use-list-state"
import { useListSearch } from "@/ux/hooks/use-list-search"
import { CATEGORY_LABELS, LIFECYCLE_META, PROVIDER_META, type InstanceStatus } from "@/ux/lib/domain"
import type { Component } from "@/ux/lib/view-types"

const PRIORITY: InstanceStatus[] = ["ERROR", "GONE", "STOPPED", "RUNNING"]
// Spec 039: prefer the backend rollup; fall back to client-computed for payloads that carry instances.
const worstStatus = (c: Component) => c.worstStatus ?? PRIORITY.find((s) => c.instances.some((i) => i.status === s)) ?? null

const toOptions = (meta: Record<string, { label: string }>) =>
  Object.entries(meta).map(([value, m]) => ({ value, label: m.label }))

// CATEGORY_LABELS is a plain value→label record (not a Meta map).
const categoryOptions = Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))

/**
 * Server-paginated components table (spec 068). All filtering, sorting,
 * search, and paging state lives in the URL via `useListState` — the table
 * renders exactly the page the API returned; it never filters client-side.
 */
export function ComponentsTable({
  data,
  list,
  pagination,
}: {
  data: Component[];
  list: ListState<ComponentsSortKey, ComponentsFilterKey>;
  pagination?: PaginationMeta;
}) {
  const [query, setQuery] = useListSearch(list)
  const total = pagination?.total ?? data.length

  const sortProps = {
    sort: list.sort,
    order: list.order,
    onSortChange: (sort: string | null, order: "asc" | "desc") =>
      list.setSort((sort as ComponentsSortKey | null) ?? null, order),
  }

  return (
    <div className="flex flex-col gap-4">
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search name, resource type, tag"
        resultCount={data.length}
        total={total}
        filters={[
          {
            id: "provider",
            label: "Provider",
            value: list.filters.provider,
            onChange: (v) => list.setFilter("provider", v),
            options: toOptions(PROVIDER_META),
          },
          {
            id: "category",
            label: "Category",
            value: list.filters.category,
            onChange: (v) => list.setFilter("category", v),
            options: categoryOptions,
          },
          {
            id: "lifecycle",
            label: "Lifecycle",
            value: list.filters.lifecycle,
            onChange: (v) => list.setFilter("lifecycle", v),
            options: toOptions(LIFECYCLE_META),
          },
          {
            id: "wired",
            label: "Coverage",
            value: list.filters.wired,
            onChange: (v) => list.setFilter("wired", v),
            options: [
              { value: "wired", label: "Wired" },
              { value: "unwired", label: "Unwired" },
            ],
          },
          {
            // Spec 068 gone-instances fix: real options only — emptyValue
            // "hide" means no phantom "All" and Clear restores "hide".
            id: "gone",
            label: "Gone instances",
            value: list.filters.gone,
            onChange: (v) => list.setFilter("gone", v),
            emptyValue: "hide",
            options: [
              { value: "hide", label: "Hidden" },
              { value: "show", label: "Shown" },
            ],
          },
        ]}
      />
      <Card className="overflow-hidden py-0">
        {data.length === 0 ? (
          <EmptyState title="No components match" description="Try a different search or clear the filters." className="border-0" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <SortableTableHead sortKey="name" {...sortProps} className="pl-4">Component</SortableTableHead>
                <SortableTableHead sortKey="category" {...sortProps}>Category</SortableTableHead>
                <SortableTableHead sortKey="resourceType" {...sortProps}>Resource type</SortableTableHead>
                <SortableTableHead sortKey="owner" {...sortProps}>Owner</SortableTableHead>
                {flags.componentListHealth && <SortableTableHead sortKey="health" {...sortProps}>Health</SortableTableHead>}
                <SortableTableHead sortKey="instances" {...sortProps} className="text-right">Instances</SortableTableHead>
                {flags.componentListLastSeen && <SortableTableHead sortKey="lastSeenAt" {...sortProps} className="pr-4 text-right">Last seen</SortableTableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="pl-4">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <ProviderMark provider={c.provider} size="sm" />
                      <TitleWithSummary
                        className="min-w-0"
                        title={
                          <Link to={ux(`/components/${c.slug}`)} className="block truncate font-mono text-sm underline-offset-4 hover:underline">
                            {c.name}
                          </Link>
                        }
                        titleText={c.name}
                        summary={{ kind: "component", row: c }}
                      />
                    </div>
                  </TableCell>
                  <TableCell>{CATEGORY_LABELS[c.category] ?? c.category}</TableCell>
                  <TableCell>
                    <code className="font-mono text-xs text-muted-foreground">{c.resourceType}</code>
                  </TableCell>
                  <TableCell className="text-sm">{c.teamOwnerName ?? <span className="text-muted-foreground">Unowned</span>}</TableCell>
                  {flags.componentListHealth && <TableCell>{c.lifecycle === "RETIRED" ? <LifecycleBadge value="RETIRED" /> : <HealthBadge value={worstStatus(c)} />}</TableCell>}
                  <TableCell className="tabular text-right">{c.instanceCount}</TableCell>
                  {flags.componentListLastSeen && <TableCell className="pr-4 text-right text-sm text-muted-foreground"><RelativeTime iso={c.lastSeenAt} /></TableCell>}
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
