import { AlertTriangleIcon, DatabaseIcon, HistoryIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { useValidatedTab } from "@/ux/lib/use-validated-tab"
import { toast } from "sonner"
import { ActivityFeed } from "@/ux/components/patterns/activity-feed"
import { ConfirmDialog } from "@/ux/components/patterns/confirm-dialog"
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header"
import { DescriptionList, MonoValue, RelativeTime } from "@/ux/components/patterns/primitives"
import { StatusBadge } from "@/ux/components/patterns/status-badge"
import { EmptyState } from "@/ux/components/patterns/states"
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert"
import { Button } from "@/ux/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ux/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ux/components/ui/tabs"
import { useSession } from "@/api/hooks/auth"
import { canAccess } from "@/ux/lib/nav"
import { PROVIDER_META, RUN_STATUS_META, SOURCE_STATUS_META } from "@/ux/lib/domain"
import { formatDateTime } from "@/ux/lib/format"
import { useReactivateSource, useRetireSource } from "@/api/hooks/importer-sources"
import { mapImportRun } from "@/api/mappers/operations"
import type { AuditEvent, ImporterSource } from "@/ux/lib/view-types"
import type { ImportRun as ApiImportRun, SourceMembershipsResponse } from "@/api/types"
import { ux } from "@/ux/lib/paths"

const TABS = ["overview", "runs", "memberships", "activity"]

interface SourceDetailProps {
  source: ImporterSource
  runs: ApiImportRun[]
  memberships: SourceMembershipsResponse | undefined
  events: AuditEvent[]
}

function DetailsSummary({ details }: { details: Record<string, unknown> | null }) {
  if (!details || Object.keys(details).length === 0)
    return <span className="text-sm text-muted-foreground">—</span>
  const pairs = Object.entries(details)
    .filter(([, v]) => v !== null && v !== undefined)
    .slice(0, 3)
  return (
    <span className="font-mono text-xs text-muted-foreground">
      {pairs.map(([k, v]) => `${k}=${String(v)}`).join(" ")}
      {Object.keys(details).length > pairs.length ? " …" : ""}
    </span>
  )
}

export function SourceDetail({ source, runs, memberships, events }: SourceDetailProps) {
  const [tab, setTab] = useValidatedTab(TABS)
  const session = useSession()
  const isAdmin = canAccess(session.data?.role ?? "VIEWER", "ADMIN")
  const retireSource = useRetireSource()
  const reactivateSource = useReactivateSource()
  const viewRuns = runs.map(mapImportRun)
  const retired = source.status === "RETIRED"

  return (
    <PageContainer>
      <PageHeader
        media={
          <div className="flex size-12 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
            <DatabaseIcon className="size-6" aria-hidden="true" />
          </div>
        }
        title={<span className="font-mono">{source.label ?? source.externalIdentity}</span>}
        description={`${PROVIDER_META[source.provider]?.label ?? source.importerName} source (${source.importerName}) · first seen ${formatDateTime(source.createdAt)}`}
        meta={<StatusBadge {...SOURCE_STATUS_META[source.status]} />}
      />

      {source.status === "UNMONITORED" && (
        <Alert>
          <AlertTriangleIcon />
          <AlertTitle>This source is unmonitored</AlertTitle>
          <AlertDescription>
            No config feeds it right now. A config reporting the same provider identity rebinds automatically on its next
            run — sources are never matched by name.
          </AlertDescription>
        </Alert>
      )}
      {retired && (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>This source is retired</AlertTitle>
          <AlertDescription>
            Its memberships are excluded from catalog reads until it is reactivated.
          </AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
          <TabsTrigger value="memberships">Memberships</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Provenance</CardTitle>
              <CardDescription>Provider-native identity and current binding. Read-only — reported by importers.</CardDescription>
            </CardHeader>
            <CardContent>
              <DescriptionList
                items={[
                  { label: "External identity", value: <MonoValue value={source.externalIdentity} /> },
                  { label: "Label", value: source.label ?? "—" },
                  { label: "Importer", value: <code className="font-mono text-xs">{source.importerName}</code> },
                  {
                    label: "Bound config",
                    value: source.boundConfig ? (
                      <Link to={ux(`/importers/${source.boundConfig.id}`)} className="hover:underline">
                        {source.boundConfig.label}
                      </Link>
                    ) : (
                      "—"
                    ),
                  },
                  { label: "Status", value: <StatusBadge {...SOURCE_STATUS_META[source.status]} /> },
                  {
                    label: "Last complete run",
                    value: source.lastCompletedRunAt ? <RelativeTime iso={source.lastCompletedRunAt} /> : "Never",
                  },
                  { label: "Component memberships", value: source.activeComponentMemberships },
                  { label: "Instance memberships", value: source.activeInstanceMemberships },
                  { label: "First seen in run", value: source.firstSeenInRunId ? <MonoValue value={source.firstSeenInRunId} /> : "—" },
                  { label: "Last seen in run", value: source.lastSeenInRunId ? <MonoValue value={source.lastSeenInRunId} /> : "—" },
                ]}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="runs" className="mt-4">
          <Card className="overflow-hidden py-0">
            {viewRuns.length === 0 ? (
              <EmptyState icon={HistoryIcon} title="No runs yet" description="Import runs attributed to this source appear here." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="pl-4">Result</TableHead>
                    <TableHead>Started</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead className="text-right">Processed</TableHead>
                    <TableHead className="text-right">Created</TableHead>
                    <TableHead className="text-right">Updated</TableHead>
                    <TableHead className="pr-4">Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {viewRuns.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="pl-4">
                        <StatusBadge {...RUN_STATUS_META[r.status]} />
                      </TableCell>
                      <TableCell className="text-sm">{r.startedAt ? formatDateTime(r.startedAt) : "—"}</TableCell>
                      <TableCell className="tabular text-sm">{r.durationSec != null ? `${r.durationSec}s` : "—"}</TableCell>
                      <TableCell className="tabular text-right">{r.assetsProcessed}</TableCell>
                      <TableCell className="tabular text-right">{r.assetsCreated}</TableCell>
                      <TableCell className="tabular text-right">{r.assetsUpdated}</TableCell>
                      <TableCell className="pr-4 text-sm text-muted-foreground">
                        {r.errorType ?? "—"}
                        {r.configId ? (
                          <>
                            {" · "}
                            <Link to={ux(`/importers/${r.configId}/runs/${r.id}`)} className="text-xs hover:underline">
                              open run
                            </Link>
                          </>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="memberships" className="mt-4 grid gap-4">
          <Card className="overflow-hidden py-0">
            <CardHeader className="px-4 pt-4">
              <CardTitle className="text-base">Components</CardTitle>
              <CardDescription>Catalog components this source reports — the unit of source-scoped reconciliation.</CardDescription>
            </CardHeader>
            {(memberships?.components.length ?? 0) === 0 ? (
              <EmptyState icon={DatabaseIcon} title="No component memberships" description="Components appear after a run reports them." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="pl-4">Component</TableHead>
                    <TableHead>External ID</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead className="pr-4">Source details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {memberships!.components.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="pl-4 text-sm font-medium">{m.componentName ?? m.componentId}</TableCell>
                      <TableCell className="max-w-64">
                        {m.componentExternalId ? <MonoValue value={m.componentExternalId} copy={false} /> : "—"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={m.active ? "success" : "neutral"} label={m.active ? "Active" : "Inactive"} />
                      </TableCell>
                      <TableCell className="pr-4">
                        <DetailsSummary details={m.details} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
          <Card className="overflow-hidden py-0">
            <CardHeader className="px-4 pt-4">
              <CardTitle className="text-base">Instances</CardTitle>
              <CardDescription>Component instances this source reports.</CardDescription>
            </CardHeader>
            {(memberships?.instances.length ?? 0) === 0 ? (
              <EmptyState icon={DatabaseIcon} title="No instance memberships" description="Instances appear after a run reports them." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="pl-4">Instance external ID</TableHead>
                    <TableHead>Active</TableHead>
                    <TableHead className="pr-4">Source details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {memberships!.instances.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="max-w-96 pl-4">
                        {m.instanceExternalId ? <MonoValue value={m.instanceExternalId} copy={false} /> : m.componentInstanceId}
                      </TableCell>
                      <TableCell>
                        <StatusBadge tone={m.active ? "success" : "neutral"} label={m.active ? "Active" : "Inactive"} />
                      </TableCell>
                      <TableCell className="pr-4">
                        <DetailsSummary details={m.details} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
          {memberships?.truncated ? (
            <p className="text-sm text-muted-foreground">Showing the first 200 rows of each list — the rest are truncated.</p>
          ) : null}
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <Card>
            <CardContent>
              {events.length === 0 ? (
                <EmptyState icon={HistoryIcon} title="No activity recorded" description="Lifecycle events (bound, unmonitored, retired, reactivated) show up here." />
              ) : (
                <ActivityFeed events={events} />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {isAdmin && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle>Danger zone</CardTitle>
            <CardDescription>Lifecycle controls — always ask for confirmation.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col divide-y">
            {!retired ? (
              <div className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">Retire source</span>
                  <span className="text-sm text-muted-foreground">
                    Excludes its memberships from catalog reads. Reversible — reactivate brings it back.
                  </span>
                </div>
                <ConfirmDialog
                  trigger={<Button variant="destructive">Retire source</Button>}
                  title={`Retire ${source.label ?? source.externalIdentity}?`}
                  description="The source and its memberships stop contributing to catalog queries until reactivated."
                  confirmLabel="Retire source"
                  typeToConfirm={source.label ?? source.externalIdentity}
                  onConfirm={() =>
                    retireSource.mutate(source.id, {
                      onSuccess: () => toast.success("Source retired"),
                      onError: (e) => toast.error(e.message),
                    })
                  }
                />
              </div>
            ) : (
              <div className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-medium">Reactivate source</span>
                  <span className="text-sm text-muted-foreground">
                    Restores it — ACTIVE when a config is bound, UNMONITORED otherwise.
                  </span>
                </div>
                <ConfirmDialog
                  trigger={<Button variant="outline">Reactivate source</Button>}
                  title={`Reactivate ${source.label ?? source.externalIdentity}?`}
                  description="The source resumes contributing to catalog queries."
                  confirmLabel="Reactivate"
                  onConfirm={() =>
                    reactivateSource.mutate(source.id, {
                      onSuccess: () => toast.success("Source reactivated"),
                      onError: (e) => toast.error(e.message),
                    })
                  }
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </PageContainer>
  )
}
