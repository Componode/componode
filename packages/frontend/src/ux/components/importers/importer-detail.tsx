
import { CircleAlertIcon, PlayIcon, Settings2Icon } from "lucide-react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import type { PaginationMeta } from "@/api/types"
import type { ImporterRunsFilterKey, ImporterRunsSortKey } from "@/api/hooks/importers"
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header"
import { DescriptionList, RelativeTime } from "@/ux/components/patterns/primitives"
import { ProviderMark } from "@/ux/components/patterns/provider-mark"
import { ListPagination } from "@/ux/components/patterns/list-pagination"
import { SortableTableHead } from "@/ux/components/patterns/sortable-header"
import { RunStatusBadge, StatusBadge } from "@/ux/components/patterns/status-badge"
import { TitleWithSummary } from "@/ux/components/patterns/title-with-summary"
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert"
import { Button } from "@/ux/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/ux/components/ui/card"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/ux/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table"
import type { ListState } from "@/ux/hooks/use-list-state"
import { PROVIDER_META, RUN_STATUS_META, type RunStatus } from "@/ux/lib/domain"
import { formatDuration, formatNumber } from "@/ux/lib/format"
import { useConvertSecrets, useTriggerImportRun } from "@/api/hooks/importers"
import { ux } from "@/ux/lib/paths"
import type { ImporterConfig, ImportRun } from "@/ux/lib/view-types"
import type { CollectionScope } from "@componode/core"

/** Read-only profile listing for Web/API collection importers (spec 058):
 *  the config's declared profiles, their instances, and managed checks. */
function ProfilesCard({ scope }: { scope: unknown }) {
  const s = scope as CollectionScope | null
  if (!s || !Array.isArray(s.components)) return null
  return (
    <Card className="overflow-hidden pb-0">
      <CardHeader>
        <CardTitle>Component profiles</CardTitle>
        <CardDescription>
          Declared on this configuration — Components, instances, and managed
          URL checks materialize on each run. Edit via Configure.
        </CardDescription>
      </CardHeader>
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/40 hover:bg-muted/40">
            <TableHead className="pl-6">Component</TableHead>
            <TableHead>Environment</TableHead>
            <TableHead>Instance URL</TableHead>
            <TableHead className="pr-6">Check</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {s.components.flatMap((c) =>
            c.instances.map((inst, ii) => (
              <TableRow key={inst.instanceKey}>
                <TableCell className="pl-6 font-medium">
                  {ii === 0 ? c.name : ""}
                </TableCell>
                <TableCell className="text-sm">{inst.environment}</TableCell>
                <TableCell>
                  <code className="font-mono text-xs">{inst.url}</code>
                </TableCell>
                <TableCell className="pr-6 text-sm text-muted-foreground">
                  {inst.check.name}
                  {inst.check.enabled === false && " (disabled)"}
                </TableCell>
              </TableRow>
            )),
          )}
        </TableBody>
      </Table>
    </Card>
  )
}

export function ImporterDetail({
  importer: i,
  runs,
  lastRun,
  runsList,
  runsPagination,
}: {
  importer: ImporterConfig
  runs: ImportRun[]
  /**
   * The newest run across ALL history (spec 068 review T063) — fetched
   * independently of the run-history table's page/sort/filter so the
   * failure alert below always reflects the latest run.
   */
  lastRun?: ImportRun | null
  /** URL-backed state for the server-paginated run history (spec 068). */
  runsList: ListState<ImporterRunsSortKey, ImporterRunsFilterKey>
  runsPagination?: PaginationMeta
}) {
  const trigger = useTriggerImportRun()
  const convert = useConvertSecrets()
  // `runs` is only the current server page — under a non-default sort,
  // filter, or page its first row is NOT necessarily the latest run, so
  // the alert reads the dedicated latest-run fetch instead.
  const failed = lastRun?.status === "FAILED"
  const lastError = lastRun?.errorMessage

  const sortProps = {
    sort: runsList.sort,
    order: runsList.order,
    onSortChange: (sort: string | null, order: "asc" | "desc") =>
      runsList.setSort((sort as ImporterRunsSortKey | null) ?? null, order),
  }
  return (
    <PageContainer>
      <PageHeader
        media={<ProviderMark provider={i.importerName} size="lg" />}
        title={i.label}
        description={`${PROVIDER_META[i.importerName].label} · ${i.scheduleLabel}`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={ux(`/importers/${i.id}/edit`)}>
                <Settings2Icon data-icon="inline-start" />
                Configure
              </Link>
            </Button>
            <Button
              disabled={!i.enabled || trigger.isPending}
              onClick={() =>
                trigger.mutate(i.id, {
                  onSuccess: () => toast.success("Run queued"),
                  onError: (e) => toast.error(e.message),
                })
              }
            >
              <PlayIcon data-icon="inline-start" />
              Run now
            </Button>
          </>
        }
      />

      {i.agentIncompatible && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>Bound agent cannot serve this importer</AlertTitle>
          <AlertDescription>
            The agent is revoked or its allowed-importers policy excludes {i.importerName}. Rebind or adjust the agent policy — the next scheduled run will fail.
          </AlertDescription>
        </Alert>
      )}
      {i.secretRefsDeprecated && (
        <Alert>
          <CircleAlertIcon />
          <AlertTitle>Legacy secret references</AlertTitle>
          <AlertDescription className="flex items-center justify-between gap-4">
            <span>This config still uses env/file secret references.</span>
            <Button
              variant="outline"
              size="sm"
              disabled={convert.isPending}
              onClick={() =>
                convert.mutate(i.id, {
                  onSuccess: (r) => toast.success(`Secrets converted — linked credential “${r.credential.label}”`),
                  onError: (e) => toast.error(e.message),
                })
              }
            >
              Convert secrets
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {failed && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>The last run failed</AlertTitle>
          <AlertDescription>
            {lastError ?? "Unknown error"}. Rotate the credential “{i.credentialLabel}” and run again.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="overflow-hidden pb-0 lg:col-span-2">
          <CardHeader>
            <CardTitle>Run history</CardTitle>
            <CardDescription>Runs are kept for 90 days. Interrupted runs resume from their last phase.</CardDescription>
            <CardAction>
              <Select value={runsList.filters.status} onValueChange={(v) => runsList.setFilter("status", v)}>
                <SelectTrigger size="sm" aria-label="Filter runs by status" className="w-auto min-w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="all">All statuses</SelectItem>
                    {(Object.keys(RUN_STATUS_META) as RunStatus[]).map((s) => (
                      <SelectItem key={s} value={s}>{RUN_STATUS_META[s].label}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </CardAction>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <SortableTableHead sortKey="status" {...sortProps} className="pl-6">Status</SortableTableHead>
                <SortableTableHead sortKey="startedAt" {...sortProps}>Started</SortableTableHead>
                <TableHead>Trigger</TableHead>
                <SortableTableHead sortKey="assetsProcessed" {...sortProps} className="text-right">Processed</SortableTableHead>
                <TableHead className="text-right">Created / updated</TableHead>
                <TableHead className="pr-6 text-right">Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="pl-6">
                    <div className="flex flex-col gap-1">
                      <RunStatusBadge value={r.status} />
                      {r.currentPhase && <span className="text-xs text-muted-foreground">{r.currentPhase}</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    <TitleWithSummary
                      title={
                        <Link to={ux(`/importers/${i.id}/runs/${r.id}`)} className="hover:underline">
                          <RelativeTime iso={r.startedAt} />
                        </Link>
                      }
                      titleText={r.startedAt ?? r.id}
                      summary={{ kind: "importRun", row: r }}
                    />
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.triggeredBy}</TableCell>
                  <TableCell className="tabular text-right">{formatNumber(r.assetsProcessed)}</TableCell>
                  <TableCell className="tabular text-right text-muted-foreground">
                    +{r.assetsCreated} / ~{r.assetsUpdated}
                  </TableCell>
                  <TableCell className="tabular pr-6 text-right">{formatDuration(r.durationSec)}</TableCell>
                </TableRow>
              ))}
              {runs.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-10 text-center text-sm text-muted-foreground">
                    No runs match the current filters.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
          {runsPagination && runsPagination.total > 0 && (
            <div className="border-t px-6 py-3">
              <ListPagination
                page={runsList.page}
                pageSize={runsList.pageSize}
                total={runsPagination.total}
                pageCount={runsPagination.pageCount}
                onPageChange={runsList.setPage}
                onPageSizeChange={runsList.setPageSize}
              />
            </div>
          )}
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Configuration</CardTitle>
          </CardHeader>
          <CardContent>
            <DescriptionList
              className="sm:grid-cols-1"
              items={[
                { label: "Provider", value: PROVIDER_META[i.importerName].label },
                { label: "Schedule", value: i.scheduleLabel },
                { label: "Cron", value: <code className="font-mono text-xs">{i.schedule ?? "Manual only"}</code> },
                { label: "Credential", value: i.credentialLabel },
                { label: "Status", value: i.enabled ? "Enabled" : "Paused" },
                {
                  label: "Executor",
                  value: i.agent ? (
                    <span className="flex items-center gap-2">
                      <Link to={ux(`/agents/${i.agent.id}`)} className="text-primary hover:underline">
                        {i.agent.name}
                      </Link>
                      {i.agentIncompatible && (
                        <StatusBadge tone="warning" label="Cannot serve this importer" />
                      )}
                    </span>
                  ) : (
                    "Hub (in-process)"
                  ),
                },
              ]}
            />
          </CardContent>
        </Card>
      </div>
      {(i.importerName === "WEB_URL" || i.importerName === "API_URL") && (
        <ProfilesCard scope={i.scope} />
      )}
    </PageContainer>
  )
}
