
import { ChevronRightIcon, SearchXIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { useNavigate } from "react-router-dom"
import * as React from "react"
import type { PaginationMeta } from "@/api/types"
import type { AgentsFilterKey, AgentsSortKey } from "@/api/hooks/agents"
import { ListPagination } from "@/ux/components/patterns/list-pagination"
import { ListToolbar } from "@/ux/components/patterns/list-toolbar"
import { RelativeTime } from "@/ux/components/patterns/primitives"
import { SortableTableHead } from "@/ux/components/patterns/sortable-header"
import { AgentCredentialBadge, AgentStatusBadge } from "@/ux/components/patterns/status-badge"
import { TitleWithSummary } from "@/ux/components/patterns/title-with-summary"
import { EmptyState } from "@/ux/components/patterns/states"
import { Badge } from "@/ux/components/ui/badge"
import { Card } from "@/ux/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table"
import type { ListState } from "@/ux/hooks/use-list-state"
import { useListSearch } from "@/ux/hooks/use-list-search"
import { AGENT_STATUS_META, type AgentStatus } from "@/ux/lib/domain"
import { ux } from "@/ux/lib/paths"
import type { ImportAgent } from "@/ux/lib/view-types"

function ImporterScope({ allowed }: { allowed: string[] }) {
  if (allowed.length === 0) return <span className="text-sm text-muted-foreground">All importers</span>
  const shown = allowed.slice(0, 2)
  return (
    <div className="flex flex-wrap items-center gap-1">
      {shown.map((i) => (
        <Badge key={i} variant="secondary" className="font-mono text-xs">
          {i}
        </Badge>
      ))}
      {allowed.length > shown.length && <span className="text-xs text-muted-foreground">+{allowed.length - shown.length}</span>}
    </div>
  )
}

export function AgentStatusCell({ agent }: { agent: ImportAgent }) {
  return agent.credentialState === "ACTIVE" ? (
    <AgentStatusBadge value={agent.status} />
  ) : (
    <AgentCredentialBadge value={agent.credentialState} />
  )
}

/**
 * Server-paginated agents table (spec 068). Filtering, sorting, search,
 * and paging state lives in the URL via `useListState` — the table renders
 * exactly the page the API returned; it never filters client-side.
 */
export function AgentsTable({
  rows,
  list,
  pagination,
}: {
  rows: ImportAgent[]
  list: ListState<AgentsSortKey, AgentsFilterKey>
  pagination?: PaginationMeta
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useListSearch(list)
  const total = pagination?.total ?? rows.length

  const sortProps = {
    sort: list.sort,
    order: list.order,
    onSortChange: (sort: string | null, order: "asc" | "desc") =>
      list.setSort((sort as AgentsSortKey | null) ?? null, order),
  }

  return (
    <div className="flex flex-col gap-4">
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search agent or importer"
        resultCount={rows.length}
        total={total}
        filters={[
          {
            id: "status",
            label: "Status",
            value: list.filters.status,
            onChange: (v) => list.setFilter("status", v),
            options: (Object.keys(AGENT_STATUS_META) as AgentStatus[]).map((s) => ({ value: s, label: AGENT_STATUS_META[s].label })),
          },
        ]}
      />
      {rows.length === 0 ? (
        <Card className="py-0">
          <EmptyState icon={SearchXIcon} title="No agents match" description="Try a different search or clear the status filter." />
        </Card>
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <SortableTableHead sortKey="name" {...sortProps} className="pl-4">Agent</SortableTableHead>
                <SortableTableHead sortKey="status" {...sortProps}>Status</SortableTableHead>
                <SortableTableHead sortKey="agentVersion" {...sortProps}>Version</SortableTableHead>
                <TableHead>Importers</TableHead>
                <SortableTableHead sortKey="boundConfigCount" {...sortProps} className="text-right">Bound configs</SortableTableHead>
                <SortableTableHead sortKey="lastSeenAt" {...sortProps}>Last seen</SortableTableHead>
                <TableHead className="w-10 pr-4">
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((a) => (
                <TableRow key={a.id} className="cursor-pointer" onClick={() => navigate(ux(`/agents/${a.id}`))}>
                  <TableCell className="max-w-64 pl-4">
                    <TitleWithSummary
                      className="min-w-0"
                      title={
                        <Link to={ux(`/agents/${a.id}`)} className="block truncate font-mono text-sm hover:underline" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                          {a.name}
                        </Link>
                      }
                      titleText={a.name}
                      summary={{ kind: "agent", row: a }}
                    />
                  </TableCell>
                  <TableCell>
                    <AgentStatusCell agent={a} />
                  </TableCell>
                  <TableCell className="tabular font-mono text-xs text-muted-foreground">{a.agentVersion ?? "—"}</TableCell>
                  <TableCell>
                    <ImporterScope allowed={a.allowedImporters} />
                  </TableCell>
                  <TableCell className="tabular text-right">{a.boundConfigs}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {a.lastSeenAt ? <RelativeTime iso={a.lastSeenAt} /> : "Never"}
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
