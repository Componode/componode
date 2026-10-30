
import { LaptopIcon, LogOutIcon } from "lucide-react"
import { toast } from "sonner"
import { ConfirmDialog } from "@/ux/components/patterns/confirm-dialog"
import { RelativeTime } from "@/ux/components/patterns/primitives"
import { EmptyState } from "@/ux/components/patterns/states"
import { StatusBadge } from "@/ux/components/patterns/status-badge"
import { Button } from "@/ux/components/ui/button"
import { Card } from "@/ux/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table"
import { useRevokeSession } from "@/api/hooks/sessions"
import { flags } from "@/ux/lib/flags"
import type { Session } from "@/ux/lib/view-types"

export function SessionsTable({ data, showOwner = true }: { data: Session[]; showOwner?: boolean }) {
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
            {flags.sessionLocation && <TableHead>Location</TableHead>}
            <TableHead>Last seen</TableHead>
            <TableHead>Expires</TableHead>
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
                    <span className="font-medium">{s.device}</span>
                  ) : (
                    <code className="font-mono text-xs text-muted-foreground">{s.id.slice(0, 8)}</code>
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
