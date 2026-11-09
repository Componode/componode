import { LaptopIcon, LogOutIcon } from "lucide-react"
import { toast } from "sonner"
import { ConfirmDialog } from "@/ux/components/patterns/confirm-dialog"
import { RelativeTime } from "@/ux/components/patterns/primitives"
import { SortableTableHead, type ListSortBindings } from "@/ux/components/patterns/sortable-header"
import type { SummaryField } from "@/ux/components/patterns/title-with-summary"
import { TitleWithSummary } from "@/ux/components/patterns/title-with-summary"
import { EmptyState } from "@/ux/components/patterns/states"
import { StatusBadge } from "@/ux/components/patterns/status-badge"
import { Button } from "@/ux/components/ui/button"
import { Card } from "@/ux/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table"
import { useRevokeSession } from "@/api/hooks/sessions"
import { flags } from "@/ux/lib/flags"
import type { Session } from "@/ux/lib/view-types"

const Dash = () => <span className="text-muted-foreground">—</span>
const textOrDash = (v: string | null | undefined) => (v ? v : <Dash />)

/**
 * Curated hover-summary fields for a session row (spec 068 US4 / T062) —
 * explicit allowlist of already-returned list fields; no secrets (the
 * session token/id is never rendered).
 */
function sessionSummary(s: Session): SummaryField[] {
  return [
    { label: "Device", value: textOrDash(s.device) },
    { label: "Location", value: textOrDash(s.location) },
    { label: "User", value: textOrDash(s.displayName) },
    { label: "Last seen", value: <RelativeTime iso={s.lastSeenAt} /> },
    { label: "Expires", value: <RelativeTime iso={s.expiresAt} /> },
    { label: "Signed in", value: <RelativeTime iso={s.createdAt} /> },
  ]
}

/**
 * Sessions table — spec 068: one server page at a time; sort is owned by
 * the page's `useListState`. Sortable headers cover the contract keys
 * (`location` orders by the stored ip column; `createdAt` is the endpoint
 * default and has no column). The device label is app-computed from the
 * user agent, so it has no sort key — it does carry the hover summary.
 * Revoke actions are unchanged.
 */
export function SessionsTable({ data, showOwner = true, sort, order, onSortChange }: { data: Session[]; showOwner?: boolean } & ListSortBindings) {
  const revokeSession = useRevokeSession()
  const revoke = (s: Session) =>
    revokeSession.mutate(s.id, {
      onSuccess: () => toast.success("Session revoked"),
      onError: (e) => toast.error(e.message),
    })
  if (data.length === 0) {
    return (
      <Card className="py-0">
        <EmptyState icon={LaptopIcon} title="No active sessions" description="Everyone is signed out. New sessions appear here as people sign in." />
      </Card>
    )
  }
  return (
    <Card className="overflow-hidden py-0">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            {flags.sessionDevice && <TableHead className="pl-4">Device</TableHead>}
            {!flags.sessionDevice && <TableHead className="pl-4">Session</TableHead>}
            {flags.sessionOwner && showOwner && <TableHead>User</TableHead>}
            {flags.sessionLocation && (
              <SortableTableHead sortKey="location" sort={sort} order={order} onSortChange={onSortChange}>
                Location
              </SortableTableHead>
            )}
            <SortableTableHead sortKey="lastSeenAt" sort={sort} order={order} onSortChange={onSortChange}>
              Last seen
            </SortableTableHead>
            <SortableTableHead sortKey="expiresAt" sort={sort} order={order} onSortChange={onSortChange}>
              Expires
            </SortableTableHead>
            <TableHead className="pr-4 text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="pl-4">
                <div className="flex items-center gap-2.5">
                  <LaptopIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                  {flags.sessionDevice ? (
                    <TitleWithSummary
                      className="max-w-56"
                      title={<span className="block truncate font-medium">{s.device}</span>}
                      titleText={s.device}
                      summary={sessionSummary(s)}
                      focusable
                    />
                  ) : (
                    <TitleWithSummary
                      className="max-w-56"
                      title={<code className="block truncate font-mono text-xs text-muted-foreground">{s.id.slice(0, 8)}</code>}
                      titleText={s.id.slice(0, 8)}
                      summary={sessionSummary(s)}
                      focusable
                    />
                  )}
                  {flags.sessionCurrent && s.current && <StatusBadge tone="brand" label="This device" />}
                </div>
              </TableCell>
              {flags.sessionOwner && showOwner && <TableCell className="text-sm">{s.displayName}</TableCell>}
              {flags.sessionLocation && <TableCell className="text-sm text-muted-foreground">{s.location}</TableCell>}
              <TableCell className="text-sm text-muted-foreground">
                <RelativeTime iso={s.lastSeenAt} />
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                <RelativeTime iso={s.expiresAt} />
              </TableCell>
              <TableCell className="pr-4 text-right">
                {flags.sessionCurrent && s.current ? (
                  <span className="text-xs text-muted-foreground">Current</span>
                ) : (
                  <ConfirmDialog
                    trigger={
                      <Button variant="ghost" size="sm">
                        <LogOutIcon data-icon="inline-start" />
                        Revoke
                      </Button>
                    }
                    title={`Sign out ${s.displayName}?`}
                    description="This session ends immediately. You can sign in again."
                    confirmLabel="Revoke session"
                    onConfirm={() => revoke(s)}
                  />
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}
