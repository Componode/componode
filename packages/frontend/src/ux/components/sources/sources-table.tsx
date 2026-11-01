import { ChevronRightIcon, SearchXIcon } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"
import * as React from "react"
import { ListToolbar } from "@/ux/components/patterns/list-toolbar"
import { MonoValue, RelativeTime } from "@/ux/components/patterns/primitives"
import { StatusBadge } from "@/ux/components/patterns/status-badge"
import { EmptyState } from "@/ux/components/patterns/states"
import { Card } from "@/ux/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table"
import { PROVIDER_META, SOURCE_STATUS_META, type SourceStatus } from "@/ux/lib/domain"
import { ux } from "@/ux/lib/paths"
import type { ImporterSource } from "@/ux/lib/view-types"

export function SourcesTable({ rows }: { rows: ImporterSource[] }) {
  const navigate = useNavigate()
  const [query, setQuery] = React.useState("")
  const [status, setStatus] = React.useState("all")

  const visible = rows.filter(
    (s) =>
      (status === "all" || s.status === status) &&
      (query === "" ||
        `${s.externalIdentity} ${s.label ?? ""} ${s.importerName} ${s.boundConfig?.label ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase())),
  )

  return (
    <div className="flex flex-col gap-4">
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search identity, label, or importer"
        resultCount={visible.length}
        total={rows.length}
        filters={[
          {
            id: "status",
            label: "Status",
            value: status,
            onChange: setStatus,
            options: (Object.keys(SOURCE_STATUS_META) as SourceStatus[]).map((s) => ({
              value: s,
              label: SOURCE_STATUS_META[s].label,
            })),
          },
        ]}
      />
      {visible.length === 0 ? (
        <Card className="py-0">
          <EmptyState icon={SearchXIcon} title="No sources match" description="Try a different search or clear the status filter." />
        </Card>
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-4">Identity</TableHead>
                <TableHead>Importer</TableHead>
                <TableHead>Bound config</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Components</TableHead>
                <TableHead className="text-right">Instances</TableHead>
                <TableHead>Last complete run</TableHead>
                <TableHead className="w-10 pr-4">
                  <span className="sr-only">Open</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((s) => (
                <TableRow key={s.id} className="cursor-pointer" onClick={() => navigate(ux(`/sources/${s.id}`))}>
                  <TableCell className="max-w-72 pl-4">
                    <div className="flex flex-col gap-0.5">
                      <Link
                        to={ux(`/sources/${s.id}`)}
                        className="font-medium hover:underline"
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                      >
                        {s.label ?? s.externalIdentity}
                      </Link>
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
    </div>
  )
}
