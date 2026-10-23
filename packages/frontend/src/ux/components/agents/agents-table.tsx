
import { ChevronRightIcon, SearchXIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { useNavigate } from "react-router-dom"
import * as React from "react"
import { ListToolbar } from "@/ux/components/patterns/list-toolbar"
import { RelativeTime } from "@/ux/components/patterns/primitives"
import { AgentCredentialBadge, AgentStatusBadge } from "@/ux/components/patterns/status-badge"
import { EmptyState } from "@/ux/components/patterns/states"
import { Badge } from "@/ux/components/ui/badge"
import { Card } from "@/ux/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table"
import { AGENT_STATUS_META, type AgentStatus } from "@/ux/lib/domain"
import type { ImportAgent } from "@/ux/lib/mock-data"

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

export function AgentsTable({ rows }: { rows: ImportAgent[] }) {
  const navigate = useNavigate()
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("all")

  const visible = rows.filter(
    (a) =>
      (status === "all" || a.status === status) &&
      (query === "" || `${a.name} ${a.allowedImporters.join(" ")}`.toLowerCase().includes(query.toLowerCase())),
  )

  return (
    <div className="flex flex-col gap-4">
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search agent or importer"
        resultCount={visible.length}
        total={rows.length}
        filters={[
          {
            id: "status",
            label: "Status",
            value: status,
            onChange: setStatus,
            options: (Object.keys(AGENT_STATUS_META) as AgentStatus[]).map((s) => ({ value: s, label: AGENT_STATUS_META[s].label })),
          },
        ]}
      />
      {visible.length === 0 ? (
        <Card className="py-0">
          <EmptyState icon={SearchXIcon} title="No agents match" description="Try a different search or clear the status filter." />
        </Card>
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-4">Agent</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Importers</TableHead>
                <TableHead className="text-right">Bound configs</TableHead>
                <TableHead>Last seen</TableHead>
                <TableHead className="w-10 pr-4">
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((a) => (
                <TableRow key={a.id} className="cursor-pointer" onClick={() => navigate(`/agents/${a.id}`)}>
                  <TableCell className="pl-4">
                    <Link to={`/agents/${a.id}`} className="font-mono text-sm font-medium hover:underline" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                      {a.name}
                    </Link>
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
    </div>
  )
}
