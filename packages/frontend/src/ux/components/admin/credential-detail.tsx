
import { HistoryIcon, KeyRoundIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { useLocation, useNavigate, useSearchParams } from "react-router-dom"
import * as React from "react"
import { toast } from "sonner"
import { useSession } from "@/ux/components/app/session-context"
import { ActivityFeed } from "@/ux/components/patterns/activity-feed"
import { ConfirmDialog } from "@/ux/components/patterns/confirm-dialog"
import { DangerZone } from "@/ux/components/patterns/danger-zone"
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header"
import { DescriptionList, MonoValue, RelativeTime } from "@/ux/components/patterns/primitives"
import { ProviderMark } from "@/ux/components/patterns/provider-mark"
import { CredentialStatusBadge, RunStatusBadge, StatusBadge } from "@/ux/components/patterns/status-badge"
import { EmptyState } from "@/ux/components/patterns/states"
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert"
import { Button } from "@/ux/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/ux/components/ui/card"
import { Spinner } from "@/ux/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ux/components/ui/tabs"
import { PROVIDER_META } from "@/ux/lib/domain"
import { formatDate } from "@/ux/lib/format"
import type { AuditEvent, Credential, ImporterConfig } from "@/ux/lib/mock-data"
import { NOW } from "@/ux/lib/mock-data"
import { ux } from "@/ux/lib/paths"

const TABS = ["overview", "usage", "activity"]

interface CredentialDetailProps {
  initial: Credential
  importers: ImporterConfig[]
  events: AuditEvent[]
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - NOW.getTime()) / 86_400_000)
}

export function CredentialDetail({ initial, importers, events }: CredentialDetailProps) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [searchParams] = useSearchParams()
  const requestedTab = searchParams.get("tab")
  const tab = requestedTab && TABS.includes(requestedTab) ? requestedTab : "overview"
  const { user } = useSession()

  const [credential, setCredential] = React.useState(initial)
  const [testing, setTesting] = React.useState(false)
  const revoked = credential.status === "REVOKED"
  const days = daysUntil(credential.expiresAt)
  const expired = days !== null && days < 0
  const expiringSoon = days !== null && days >= 0 && days <= 30

  const setTab = (value: string) => navigate(`${pathname}?tab=${value}`, { replace: true })

  const runTest = () => {
    setTesting(true)
    window.setTimeout(() => {
      setTesting(false)
      if (expired) toast.error("Connection failed: the credential has expired")
      else toast.success("Connection succeeded", { description: "Simulated result. No request was made." })
    }, 1200)
  }

  return (
    <PageContainer>
      <PageHeader
        media={<ProviderMark provider={credential.provider} size="lg" />}
        title={credential.label}
        description={`${PROVIDER_META[credential.provider].label} credential. Secret values are encrypted and never shown again.`}
        meta={
          <>
            <CredentialStatusBadge value={credential.status} />
            <code className="font-mono text-xs text-muted-foreground">{credential.slug}</code>
          </>
        }
        actions={
          !revoked && (
            <>
              <Button variant="outline" onClick={runTest} disabled={testing}>
                {testing && <Spinner data-icon="inline-start" />}
                Test connection
              </Button>
              <ConfirmDialog
                trigger={<Button>Rotate secret</Button>}
                title="Rotate secret?"
                description={`Importers using ${credential.label} switch to the new secret on their next run.`}
                confirmLabel="Rotate"
                onConfirm={() => {
                  setCredential((c) => ({ ...c, updatedBy: user.username }))
                  toast.success(`${credential.label} rotated`, { description: "Prototype only. Nothing was saved." })
                }}
              />
            </>
          )
        }
      />

      {(expired || expiringSoon) && !revoked && (
        <Alert variant={expired ? "destructive" : "default"}>
          <KeyRoundIcon />
          <AlertTitle>{expired ? "This credential has expired" : `Expires in ${days} days`}</AlertTitle>
          <AlertDescription>
            {importers.length > 0
              ? `${importers.length} importer${importers.length === 1 ? "" : "s"} will fail until you rotate the secret.`
              : "Rotate the secret before it expires to avoid failed imports."}
          </AlertDescription>
        </Alert>
      )}
      {revoked && (
        <Alert variant="destructive">
          <KeyRoundIcon />
          <AlertTitle>Credential revoked</AlertTitle>
          <AlertDescription>It can no longer be used by any importer. Create a new credential to replace it.</AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="usage">Used by ({importers.length})</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
              <CardDescription>Metadata the hub stores in plain text.</CardDescription>
            </CardHeader>
            <CardContent>
              <DescriptionList
                items={[
                  { label: "Credential ID", value: <MonoValue value={credential.id} /> },
                  { label: "Provider", value: PROVIDER_META[credential.provider].label },
                  {
                    label: "Expires",
                    value: credential.expiresAt ? (
                      <span className="flex items-center gap-2">
                        {formatDate(credential.expiresAt)}
                        {expired && <StatusBadge tone="destructive" label="Expired" />}
                        {expiringSoon && <StatusBadge tone="warning" label={`In ${days} days`} />}
                      </span>
                    ) : (
                      "Never"
                    ),
                  },
                  { label: "Last used", value: credential.lastUsedAt ? <RelativeTime iso={credential.lastUsedAt} /> : "Never" },
                  { label: "Last changed by", value: credential.updatedBy },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Stored secret</CardTitle>
              <CardDescription>Only a masked hint is returned by the API. Rotate to replace a value.</CardDescription>
            </CardHeader>
            <CardContent>
              <DescriptionList
                items={Object.entries(credential.keyHints).map(([key, hint]) => ({
                  label: key,
                  value: <MonoValue value={hint} copy={false} />,
                }))}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="usage" className="mt-4">
          <Card className="overflow-hidden py-0">
            {importers.length === 0 ? (
              <EmptyState icon={KeyRoundIcon} title="Not used by any importer" description="Attach this credential from an importer's settings to start using it." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="pl-4">Importer</TableHead>
                    <TableHead>Schedule</TableHead>
                    <TableHead className="pr-4">Last run</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {importers.map((i) => (
                    <TableRow key={i.id}>
                      <TableCell className="pl-4">
                        <Link to={`/importers/${i.id}`} className="font-medium hover:underline">
                          {i.label}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{i.enabled ? i.scheduleLabel : "Disabled"}</TableCell>
                      <TableCell className="pr-4">
                        {i.lastRun ? <RunStatusBadge value={i.lastRun.status} /> : <span className="text-sm text-muted-foreground">Never run</span>}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <Card>
            <CardContent>
              {events.length === 0 ? (
                <EmptyState icon={HistoryIcon} title="No activity recorded" description="Rotation and revocation events show up here." />
              ) : (
                <ActivityFeed events={events} />
              )}
            </CardContent>
            <CardFooter className="border-t">
              <Button variant="link" asChild className="px-0">
                <Link to={ux("/activity")}>Open full audit log</Link>
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>
      </Tabs>

      <DangerZone
        actions={[
          ...(revoked
            ? []
            : [
                {
                  id: "revoke",
                  title: "Revoke credential",
                  description: "Importers stop using it immediately. This cannot be undone.",
                  buttonLabel: "Revoke",
                  confirmTitle: `Revoke ${credential.label}?`,
                  confirmDescription: `${importers.length} importer${importers.length === 1 ? "" : "s"} will fail until a new credential is attached.`,
                  confirmLabel: "Revoke credential",
                  typeToConfirm: credential.slug,
                  successMessage: `${credential.label} revoked`,
                  onConfirm: () => setCredential((c) => ({ ...c, status: "REVOKED" as const, updatedBy: user.username })),
                },
              ]),
          {
            id: "delete",
            title: "Delete credential",
            description: "Removes the credential and its audit trail link permanently.",
            buttonLabel: "Delete credential",
            variant: "destructive" as const,
            confirmTitle: `Delete ${credential.label}?`,
            confirmDescription: "The credential is removed permanently.",
            confirmLabel: "Delete credential",
            typeToConfirm: credential.slug,
            blockedReason:
              importers.length > 0
                ? `Detach it from the ${importers.length} importer${importers.length === 1 ? "" : "s"} using it before deleting.`
                : undefined,
            successMessage: `${credential.label} deleted`,
            redirectTo: "/credentials",
          },
        ]}
      />
    </PageContainer>
  )
}
