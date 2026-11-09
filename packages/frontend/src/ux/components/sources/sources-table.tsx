import { ChevronRightIcon, SearchXIcon } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"
import * as React from "react"
import { importerProvider } from "@/api/mappers/operations"
import type { PaginationMeta } from "@/api/types"
import type { ImporterSourcesFilterKey, ImporterSourcesSortKey } from "@/api/hooks/importer-sources"
import { ListPagination } from "@/ux/components/patterns/list-pagination"
import { ListToolbar } from "@/ux/components/patterns/list-toolbar"
import { MonoValue, RelativeTime } from "@/ux/components/patterns/primitives"
import { SortableTableHead } from "@/ux/components/patterns/sortable-header"
import { StatusBadge } from "@/ux/components/patterns/status-badge"
import { TitleWithSummary } from "@/ux/components/patterns/title-with-summary"
import { EmptyState } from "@/ux/components/patterns/states"
import { Card } from "@/ux/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table"
import type { ListState } from "@/ux/hooks/use-list-state"
import { useListSearch } from "@/ux/hooks/use-list-search"
import { IMPORTER_NAMES, PROVIDER_META, SOURCE_STATUS_META, type SourceStatus } from "@/ux/lib/domain"
import { ux } from "@/ux/lib/paths"
import type { ImporterSource } from "@/ux/lib/view-types"

const IMPORTER_OPTIONS = IMPORTER_NAMES.map((name) => ({
  value: name,
  label: PROVIDER_META[importerProvider(name)]?.label ?? name,
}))

/**
 * Server-paginated importer-sources table (spec 068). Filtering, sorting,
 * search, and paging state lives in the URL via `useListState` — the table
 * renders exactly the page the API returned; it never filters client-side.
 */
export function SourcesTable({
  rows,
  list,
  pagination,
}: {
  rows: ImporterSource[]
  list: ListState<ImporterSourcesSortKey, ImporterSourcesFilterKey>
  pagination?: PaginationMeta
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useListSearch(list)
  const total = pagination?.total ?? rows.length

  const sortProps = {
    sort: list.sort,
    order: list.order,
    onSortChange: (sort: string | null, order: "asc" | "desc") =>
      list.setSort((sort as ImporterSourcesSortKey | null) ?? null, order),
  }

  return (
    <div className="flex flex-col gap-4">
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search identity, label, or importer"
        resultCount={rows.length}
        total={total}
        filters={[
          {
            id: "status",
            label: "Status",
            value: list.filters.status,
            onChange: (v) => list.setFilter("status", v),
            options: (Object.keys(SOURCE_STATUS_META) as SourceStatus[]).map((s) => ({
              value: s,
              label: SOURCE_STATUS_META[s].label,
            })),
          },
          {
            id: "importerName",
            label: "Importer",
            value: list.filters.importerName,
            onChange: (v) => list.setFilter("importerName", v),
            options: IMPORTER_OPTIONS,
          },
        ]}
      />
      {rows.length === 0 ? (
        <Card className="py-0">
          <EmptyState icon={SearchXIcon} title="No sources match" description="Try a different search or clear the filters." />
        </Card>
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <SortableTableHead sortKey="name" {...sortProps} className="pl-4">Identity</SortableTableHead>
                <SortableTableHead sortKey="importerName" {...sortProps}>Importer</SortableTableHead>
                <SortableTableHead sortKey="boundConfig" {...sortProps}>Bound config</SortableTableHead>
                <SortableTableHead sortKey="status" {...sortProps}>Status</SortableTableHead>
                <SortableTableHead sortKey="components" {...sortProps} className="text-right">Components</SortableTableHead>
                <SortableTableHead sortKey="instances" {...sortProps} className="text-right">Instances</SortableTableHead>
                <SortableTableHead sortKey="lastCompletedRunAt" {...sortProps}>Last complete run</SortableTableHead>
                <TableHead className="w-10 pr-4">
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.id} className="cursor-pointer" onClick={() => navigate(ux(`/sources/${s.id}`))}>
                  <TableCell className="max-w-72 pl-4">
                    <div className="flex flex-col gap-0.5">
                      <TitleWithSummary
                        className="min-w-0"
                        title={
                          <Link
                            to={ux(`/sources/${s.id}`)}
                            className="block truncate font-medium hover:underline"
                            onClick={(e: React.MouseEvent) => e.stopPropagation()}
                          >
                            {s.label ?? s.externalIdentity}
                          </Link>
                        }
                        titleText={s.label ?? s.externalIdentity}
                        summary={{ kind: "importerSource", row: s }}
                      />
                      <MonoValue value={s.externalIdentity} copy={false} />
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {PROVIDER_META[s.provider]?.label ?? s.importerName}
                    <span className="ml-1 font-mono text-xs text-muted-foreground">{s.importerName}</span>
                  </TableCell>
                  <TableCell>
                    {s.boundConfig ? (
                      <Link
                        to={ux(`/importers/${s.boundConfig.id}`)}
                        className="text-sm hover:underline"
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                      >
                        {s.boundConfig.label}
                      </Link>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge {...SOURCE_STATUS_META[s.status]} />
                  </TableCell>
                  <TableCell className="tabular text-right">{s.activeComponentMemberships}</TableCell>
                  <TableCell className="tabular text-right">{s.activeInstanceMemberships}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {s.lastCompletedRunAt ? <RelativeTime iso={s.lastCompletedRunAt} /> : "Never"}
                  </TableCell>
                  <TableCell className="pr-4 text-muted-foreground">
                    <ChevronRightIcon className="size-4" aria-hidden="true" />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
      {pagination && pagination.total > 0 && (
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
