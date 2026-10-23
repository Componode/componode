
import { LaptopIcon, LogOutIcon } from "lucide-react"
import * as React from "react"
import { toast } from "sonner"
import { ConfirmDialog } from "@/ux/components/patterns/confirm-dialog"
import { RelativeTime } from "@/ux/components/patterns/primitives"
import { EmptyState } from "@/ux/components/patterns/states"
import { StatusBadge } from "@/ux/components/patterns/status-badge"
import { Button } from "@/ux/components/ui/button"
import { Card } from "@/ux/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table"
import type { Session } from "@/ux/lib/mock-data"

export function SessionsTable({ data }: { data: Session[] }) {
  const [rows, setRows] = React.useState(data)
  const revoke = (s: Session) => {
    setRows((prev) => prev.filter((x) => x.id !== s.id))
    toast.success(`Signed out ${s.displayName} on ${s.device}`)
  }
  if (rows.length === 0) {
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
            <TableHead className="pl-4">Device</TableHead>
            <TableHead>User</TableHead>
            <TableHead>Location</TableHead>
            <TableHead>Last seen</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead className="pr-4 text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((s) => (
            <TableRow key={s.id}>
              <TableCell className="pl-4">
                <div className="flex items-center gap-2.5">
                  <LaptopIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                  <span className="font-medium">{s.device}</span>
                  {s.current && <StatusBadge tone="brand" label="This device" />}
                </div>
              </TableCell>
              <TableCell className="text-sm">{s.displayName}</TableCell>
              <TableCell className="text-sm text-muted-foreground">{s.location}</TableCell>
              <TableCell className="text-sm text-muted-foreground">
                <RelativeTime iso={s.lastSeenAt} />
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                <RelativeTime iso={s.expiresAt} />
              </TableCell>
              <TableCell className="pr-4 text-right">
                {s.current ? (
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
                    description={`The session on ${s.device} will end immediately. They can sign in again.`}
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
