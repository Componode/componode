
import { KeyRoundIcon, RotateCwIcon } from "lucide-react"
import { Link } from "react-router-dom"
import * as React from "react"
import { toast } from "sonner"
import { ConfirmDialog } from "@/ux/components/patterns/confirm-dialog"
import { RelativeTime } from "@/ux/components/patterns/primitives"
import { ProviderMark } from "@/ux/components/patterns/provider-mark"
import { EmptyState } from "@/ux/components/patterns/states"
import { CredentialStatusBadge, StatusBadge } from "@/ux/components/patterns/status-badge"
import { Button } from "@/ux/components/ui/button"
import { Card } from "@/ux/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table"
import { type Credential, NOW } from "@/ux/lib/mock-data"

const DAY = 86_400_000

function Expiry({ iso }: { iso: string | null }) {
  if (!iso) return <span className="text-muted-foreground">Never</span>
  const days = Math.round((new Date(iso).getTime() - NOW.getTime()) / DAY)
  if (days < 0) return <StatusBadge tone="destructive" label="Expired" />
  if (days <= 30) return <StatusBadge tone="warning" label={`In ${days} days`} />
  return <RelativeTime iso={iso} className="text-muted-foreground" />
}

export function CredentialsTable({ data }: { data: Credential[] }) {
  const [rows, setRows] = React.useState(data)
  if (rows.length === 0) {
    return (
      <Card className="py-0">
        <EmptyState
          icon={KeyRoundIcon}
          title="No credentials yet"
          description="Add a provider credential so importers can authenticate against your sources."
        />
      </Card>
    )
  }
  return (
    <Card className="overflow-hidden py-0">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="pl-4">Credential</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Key hint</TableHead>
            <TableHead>Expires</TableHead>
            <TableHead>Last used</TableHead>
            <TableHead className="text-right">Used by</TableHead>
            <TableHead className="pr-4 text-right">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((c) => (
            <TableRow key={c.id} className={c.status === "REVOKED" ? "opacity-60" : undefined}>
              <TableCell className="pl-4">
                <div className="flex items-center gap-2.5">
                  <ProviderMark provider={c.provider} size="sm" />
                  <div className="flex flex-col">
                    <Link to={`/credentials/${c.id}`} className="font-medium hover:underline">
                      {c.label}
                    </Link>
                    <code className="font-mono text-xs text-muted-foreground">{c.slug}</code>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <CredentialStatusBadge value={c.status} />
              </TableCell>
              <TableCell>
                <code className="font-mono text-xs text-muted-foreground">
                  {Object.values(c.keyHints)[0] ? `••••${Object.values(c.keyHints)[0]}` : "—"}
                </code>
              </TableCell>
              <TableCell className="text-sm">
                <Expiry iso={c.expiresAt} />
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">{c.lastUsedAt ? <RelativeTime iso={c.lastUsedAt} /> : "Never"}</TableCell>
              <TableCell className="tabular text-right">{c.usedBy}</TableCell>
              <TableCell className="pr-4">
                {c.status === "ACTIVE" && (
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => toast.success(`${c.label} rotated`)}>
                      <RotateCwIcon data-icon="inline-start" />
                      Rotate
                    </Button>
                    <ConfirmDialog
                      trigger={
                        <Button variant="ghost" size="sm" className="text-destructive">
                          Revoke
                        </Button>
                      }
                      title={`Revoke ${c.label}?`}
                      description={`${c.usedBy} importer${c.usedBy === 1 ? "" : "s"} will fail on their next run until you assign a new credential.`}
                      confirmLabel="Revoke credential"
                      typeToConfirm={c.slug}
                      onConfirm={() => {
                        setRows((prev) => prev.map((x) => (x.id === c.id ? { ...x, status: "REVOKED" } : x)))
                        toast.success(`${c.label} revoked`)
                      }}
                    />
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  )
}
