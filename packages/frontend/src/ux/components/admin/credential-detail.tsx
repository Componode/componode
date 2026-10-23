
import { HistoryIcon, KeyRoundIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { useNavigate } from "react-router-dom"
import { useValidatedTab } from "@/ux/lib/use-validated-tab"
import { toast } from "sonner"
import { ActivityFeed } from "@/ux/components/patterns/activity-feed"
import { DangerZone } from "@/ux/components/patterns/danger-zone"
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header"
import { DescriptionList, MonoValue, RelativeTime } from "@/ux/components/patterns/primitives"
import { CredentialStatusBadge, StatusBadge } from "@/ux/components/patterns/status-badge"
import { EmptyState } from "@/ux/components/patterns/states"
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert"
import { Button } from "@/ux/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/ux/components/ui/card"
import { Spinner } from "@/ux/components/ui/spinner"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ux/components/ui/tabs"
import { formatDate } from "@/ux/lib/format"
import { useRevokeCredential, useDeleteCredential, useTestCredential } from "@/api/hooks/credentials"
import type { ImporterConfig } from "@/api/types"
import type { AuditEvent, Credential } from "@/ux/lib/view-types"
import { ux } from "@/ux/lib/paths"

const TABS = ["overview", "usage", "activity"]

interface CredentialDetailProps {
  credential: Credential
  /** Bound importer configs (full rows — scope is needed for test connection). */
  importers: ImporterConfig[]
  events: AuditEvent[]
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)
}

export function CredentialDetail({ credential, importers, events }: CredentialDetailProps) {
  const navigate = useNavigate()
  const [tab, setTab] = useValidatedTab(TABS)
  const test = useTestCredential(credential.id)
  const revokeCred = useRevokeCredential()
  const deleteCred = useDeleteCredential()
  const firstImporter = importers[0]

  const revoked = credential.status === "REVOKED"
  const days = daysUntil(credential.expiresAt)
  const expired = days !== null && days < 0
  const expiringSoon = days !== null && days >= 0 && days <= 30


  const runTest = () => {
    if (!firstImporter) return
    test.mutate(
      { importerName: firstImporter.importerName, scope: firstImporter.scope },
      {
        onSuccess: (r) => {
          if (r.ok) toast.success("Connection succeeded", { description: r.agent ? `Tested on agent ${r.agent}` : undefined })
          else toast.error(`Connection failed: ${r.error ?? "unknown error"}`)
        },
        onError: (e) => toast.error(e.message),
      },
    )
  }

  return (
    <PageContainer>
      <PageHeader
        media={<div className="flex h-10 w-10 items-center justify-center rounded-md border bg-muted text-muted-foreground"><KeyRoundIcon className="h-5 w-5" /></div>}
        title={credential.label}
        description={credential.kind === "AGENT_MANAGED" ? "Agent-managed credential — references resolve on the agent host; no secret values are stored here." : "Stored credential — secret values are encrypted and never shown again."}
        meta={
          <>
            <CredentialStatusBadge value={credential.status} />
            <code className="font-mono text-xs text-muted-foreground">{credential.slug}</code>
          </>
        }
        actions={
          !revoked && (
            <>
              <Button
                variant="outline"
                onClick={runTest}
                disabled={test.isPending || !firstImporter}
                title={firstImporter ? `Tests using the ${firstImporter.label} importer` : "Attach an importer to test"}
              >
                {test.isPending && <Spinner data-icon="inline-start" />}
                Test connection
              </Button>
              <Button asChild>
                <Link to={ux(`/credentials/${credential.id}/edit`)}>Rotate secret</Link>
              </Button>
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
                  { label: "Kind", value: credential.kind === "AGENT_MANAGED" ? "Agent-managed" : "Stored" },
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
                        <Link to={ux(`/importers/${i.id}`)} className="font-medium hover:underline">
                          {i.label}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{i.enabled ? (i.schedule ?? "Manual") : "Disabled"}</TableCell>
                      <TableCell className="pr-4 font-mono text-xs text-muted-foreground">
                        {Object.keys(i.scope).slice(0, 3).join(", ") || "—"}
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
                  onConfirm: () =>
                    revokeCred.mutate(credential.id, {
                      onError: (e) => toast.error(e.message),
                    }),
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
            onConfirm: () =>
              deleteCred.mutate(credential.id, {
                onSuccess: () => navigate(ux("/credentials")),
                onError: (e) => toast.error(e.message),
              }),
          },
        ]}
      />
    </PageContainer>
  )
}
