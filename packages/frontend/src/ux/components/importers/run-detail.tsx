
import { CircleAlertIcon, CircleCheckIcon, Loader2Icon, RadioTowerIcon, SearchIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { useValidatedTab } from "@/ux/lib/use-validated-tab"
import { toast } from "sonner"
import { ConfirmDialog } from "@/ux/components/patterns/confirm-dialog"
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header"
import { DescriptionList, MonoValue, RelativeTime } from "@/ux/components/patterns/primitives"
import { ProviderMark } from "@/ux/components/patterns/provider-mark"
import { ListPagination } from "@/ux/components/patterns/list-pagination"
import { RunStatusBadge, StatusBadge } from "@/ux/components/patterns/status-badge"
import { SortableTableHead, type ListSortBindings } from "@/ux/components/patterns/sortable-header"
import type { SummaryField } from "@/ux/components/patterns/title-with-summary"
import { TitleWithSummary } from "@/ux/components/patterns/title-with-summary"
import { EmptyState } from "@/ux/components/patterns/states"
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert"
import { Button } from "@/ux/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ux/components/ui/card"
import { Input } from "@/ux/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/ux/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ux/components/ui/tabs"
import { useListSearch } from "@/ux/hooks/use-list-search"
import { PROVIDER_META, type Tone } from "@/ux/lib/domain"
import { formatDateTime, formatDuration, formatNumber } from "@/ux/lib/format"
import { useCancelImportRun } from "@/api/hooks/importers"
import { ux } from "@/ux/lib/paths"
import type { ImporterConfig, ImportRun, RunChange, RunError } from "@/ux/lib/view-types"

const TABS = ["overview", "errors", "changes"]

const CHANGE_TONE: Record<RunChange["action"], Tone> = {
  created: "success",
  updated: "info",
  orphaned: "warning",
  retired: "neutral",
}

const actionLabel = (action: RunChange["action"]) =>
  action.charAt(0).toUpperCase() + action.slice(1)

/**
 * Curated hover-summary fields for a run-change row (spec 068 US4 / T062) —
 * explicit allowlist of already-returned list fields; the entity name is
 * the row's title-like value, everything else is context already shown.
 */
function runChangeSummary(c: RunChange): SummaryField[] {
  return [
    { label: "Type", value: <span className="capitalize">{c.entityKind}</span> },
    {
      label: "Action",
      value: <StatusBadge tone={CHANGE_TONE[c.action] ?? "neutral"} label={actionLabel(c.action)} />,
    },
    { label: "Actor", value: c.actor || <span className="text-muted-foreground">—</span> },
    { label: "Time", value: <RelativeTime iso={c.at} /> },
  ]
}

/** Shared server-pagination controls for a run-detail sub-table (spec 068). */
export interface RunListControls {
  page: number
  pageSize: number
  /** Server-reported totals for the current filter — drives badges/alerts. */
  total: number
  pageCount: number
  onPageChange: (page: number) => void
  onPageSizeChange: (pageSize: number) => void
}

export interface RunErrorsControls extends RunListControls, ListSortBindings {
  /** Direction-only change for the "Newest/Oldest first" select — keeps the
   *  active sort key (or the endpoint default when sort is cleared). */
  onOrderChange: (order: "asc" | "desc") => void
  /** Committed errorType filter ("" = unfiltered). */
  errorType: string
  onErrorTypeChange: (value: string) => void
}

export interface RunChangesControls extends RunListControls, ListSortBindings {
  /** Direction-only change for the "Newest/Oldest first" select. */
  onOrderChange: (order: "asc" | "desc") => void
  /** "all" or a RunChange action (created/updated/orphaned/retired). */
  action: string
  onActionChange: (value: string) => void
}

interface RunDetailProps {
  importer: ImporterConfig
  run: ImportRun
  errors: RunError[]
  changes: RunChange[]
  errorsList: RunErrorsControls
  changesList: RunChangesControls
  credential?: { id: string; label: string } | null
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-4">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="tabular text-2xl font-semibold">{formatNumber(value)}</span>
    </div>
  )
}

export function RunDetail({ importer, run, errors, changes, errorsList, changesList, credential }: RunDetailProps) {
  const cancel = useCancelImportRun()
  const [tab, setTab] = useValidatedTab(TABS)
  // Debounced errorType filter — commits ~300 ms after typing stops.
  const [errorTypeInput, setErrorTypeInput] = useListSearch({
    search: errorsList.errorType,
    setSearch: errorsList.onErrorTypeChange,
  })

  const active = run.status === "RUNNING" || run.status === "PENDING"
  const cancelling = active && Boolean(run.cancelRequestedAt)
  const usedCredential = credential ?? null


  const endedAt =
    run.durationSec !== null && run.startedAt !== null ? new Date(new Date(run.startedAt).getTime() + run.durationSec * 1000).toISOString() : null

  return (
    <PageContainer>
      <PageHeader
        media={<ProviderMark provider={importer.importerName} size="lg" />}
        title={
          <span>
            Run <span className="font-mono">{run.id}</span>
          </span>
        }
        description={
          <>
            <Link to={ux(`/importers/${importer.id}`)} className="font-medium text-foreground hover:underline">
              {importer.label}
            </Link>{" "}
            · {PROVIDER_META[importer.importerName].label} · triggered by {run.triggeredBy}
          </>
        }
        meta={
          <>
            <RunStatusBadge value={run.status} />
            {run.errorType && <StatusBadge tone="destructive" label={run.errorType.replaceAll("_", " ").toLowerCase()} />}
            {run.currentPhase && (
              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                {active && <Loader2Icon className="size-3.5 animate-spin" aria-hidden="true" />}
                Phase <span className="font-mono text-foreground">{run.currentPhase}</span>
              </span>
            )}
          </>
        }
        actions={
          active ? (
            cancelling ? (
              <Button variant="outline" disabled>
                <Loader2Icon data-icon="inline-start" className="animate-spin" />
                Cancelling…
              </Button>
            ) : (
              <ConfirmDialog
                trigger={<Button variant="outline" disabled={cancel.isPending}>Cancel run</Button>}
                title={`Cancel ${run.id}?`}
                description="The importer stops at the end of its current phase. Assets already processed are kept."
                confirmLabel="Cancel run"
                onConfirm={() =>
                  cancel.mutate(
                    { configId: importer.id, runId: run.id },
                    {
                      onSuccess: () => toast.success(`Cancellation requested for ${run.id}`),
                      onError: (e) => toast.error(e.message),
                    },
                  )
                }
              />
            )
          ) : null
        }
      />

      {run.status === "CANCELLED" && !run.errorMessage && (
        <Alert>
          <CircleAlertIcon />
          <AlertTitle>This run was cancelled</AlertTitle>
          <AlertDescription>
            {run.cancelReason === "TARGET_DISABLED"
              ? "Cancelled because its Docker target was disabled. Re-enable the target or point the importer at another target to run it again."
              : "Cancelled by request. Assets already processed were kept."}
          </AlertDescription>
        </Alert>
      )}
      {run.errorMessage && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>{run.status === "FAILED" ? "This run failed" : "This run reported an error"}</AlertTitle>
          <AlertDescription>
            {run.errorMessage}.{" "}
            {usedCredential && (
              <Link to={ux(`/credentials/${usedCredential.id}`)} className="font-medium underline underline-offset-4">
                Open credential {usedCredential.label}
              </Link>
            )}
          </AlertDescription>
        </Alert>
      )}
      {run.status === "COMPLETED" && errorsList.total > 0 && (
        <Alert>
          <CircleAlertIcon />
          <AlertTitle>
            Completed with {errorsList.total} warning{errorsList.total === 1 ? "" : "s"}
          </AlertTitle>
          <AlertDescription>Some assets were skipped. Open the Errors tab for the list.</AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="errors">Errors{errorsList.total > 0 ? ` (${errorsList.total})` : ""}</TabsTrigger>
          <TabsTrigger value="changes">Changes{changesList.total > 0 ? ` (${changesList.total})` : ""}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Counter label="Processed" value={run.assetsProcessed} />
            <Counter label="Created" value={run.assetsCreated} />
            <Counter label="Updated" value={run.assetsUpdated} />
            <Counter label="Orphaned" value={run.instancesOrphaned} />
            <Counter label="Retired" value={run.componentsRetired} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Timing</CardTitle>
              </CardHeader>
              <CardContent>
                <DescriptionList
                  items={[
                    { label: "Run ID", value: <MonoValue value={run.id} /> },
                    { label: "Started", value: run.startedAt ? formatDateTime(run.startedAt) : "—" },
                    { label: "Completed", value: endedAt ? formatDateTime(endedAt) : active ? "In progress" : "—" },
                    { label: "Duration", value: formatDuration(run.durationSec) },
                    { label: "Triggered by", value: run.triggeredBy },
                  ]}
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Execution</CardTitle>
                <CardDescription>Where the importer ran and which credential it used.</CardDescription>
              </CardHeader>
              <CardContent>
                <DescriptionList
                  items={[
                    {
                      label: "Executor",
                      value: run.agentId ? (
                        <span className="flex flex-wrap items-center gap-2">
                          <RadioTowerIcon className="size-4 text-muted-foreground" aria-hidden="true" />
                          <span>{run.status === "PENDING" ? "Waiting for agent" : "Ran on agent"}</span>
                          <Link to={ux(`/agents/${run.agentId}`)} className="font-mono font-medium text-primary hover:underline">
                            {run.agentName ?? run.agentId}
                          </Link>
                        </span>
                      ) : (
                        "In-process on the hub"
                      ),
                    },
                    {
                      label: "Credential",
                      value: usedCredential ? (
                        <Link to={ux(`/credentials/${usedCredential.id}`)} className="font-medium text-primary hover:underline">
                          {usedCredential.label}
                        </Link>
                      ) : (
                        "None"
                      ),
                    },
                    { label: "Importer", value: <Link to={ux(`/importers/${importer.id}`)} className="text-primary hover:underline">{importer.label}</Link> },
                    { label: "Schedule", value: importer.scheduleLabel },
                  ]}
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="errors" className="mt-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                type="search"
                value={errorTypeInput}
                onChange={(e) => setErrorTypeInput(e.target.value)}
                placeholder="Filter by error type"
                aria-label="Filter errors by type"
                className="pl-8"
              />
            </div>
            <Select value={errorsList.order} onValueChange={(v) => errorsList.onOrderChange(v as "asc" | "desc")}>
              <SelectTrigger size="sm" aria-label="Error sort order" className="w-auto min-w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="desc">Newest first</SelectItem>
                  <SelectItem value="asc">Oldest first</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <Card className="overflow-hidden py-0">
            {errors.length === 0 ? (
              <EmptyState
                icon={CircleCheckIcon}
                title={errorsList.total === 0 ? "No run errors" : "No errors on this page"}
                description={
                  errorsList.total === 0
                    ? "Nothing was skipped or rejected during this run."
                    : "Try another page or clear the error type filter."
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <SortableTableHead sortKey="assetExternalId" sort={errorsList.sort} order={errorsList.order} onSortChange={errorsList.onSortChange} className="pl-4">Asset</SortableTableHead>
                    <SortableTableHead sortKey="errorType" sort={errorsList.sort} order={errorsList.order} onSortChange={errorsList.onSortChange}>Type</SortableTableHead>
                    <SortableTableHead sortKey="errorMessage" sort={errorsList.sort} order={errorsList.order} onSortChange={errorsList.onSortChange}>Message</SortableTableHead>
                    <SortableTableHead sortKey="createdAt" sort={errorsList.sort} order={errorsList.order} onSortChange={errorsList.onSortChange} className="pr-4">Time</SortableTableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {errors.map((e) => (
                    <TableRow key={e.id}>
                      <TableCell className="pl-4 font-mono text-xs">{e.assetExternalId ?? "—"}</TableCell>
                      <TableCell>
                        <StatusBadge tone={e.errorType === "SKIPPED" ? "warning" : "destructive"} label={e.errorType} />
                      </TableCell>
                      <TableCell className="max-w-md text-sm text-pretty">{e.errorMessage}</TableCell>
                      <TableCell className="pr-4 text-sm text-muted-foreground">
                        <RelativeTime iso={e.at} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
          {errorsList.total > 0 && (
            <ListPagination
              page={errorsList.page}
              pageSize={errorsList.pageSize}
              total={errorsList.total}
              pageCount={errorsList.pageCount}
              onPageChange={errorsList.onPageChange}
              onPageSizeChange={errorsList.onPageSizeChange}
            />
          )}
        </TabsContent>

        <TabsContent value="changes" className="mt-4 flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={changesList.action} onValueChange={changesList.onActionChange}>
              <SelectTrigger size="sm" aria-label="Filter changes by action" className="w-auto min-w-40">
                <span className="text-muted-foreground">Action:</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">All actions</SelectItem>
                  <SelectItem value="created">Created</SelectItem>
                  <SelectItem value="updated">Updated</SelectItem>
                  <SelectItem value="orphaned">Orphaned</SelectItem>
                  <SelectItem value="retired">Retired</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select value={changesList.order} onValueChange={(v) => changesList.onOrderChange(v as "asc" | "desc")}>
              <SelectTrigger size="sm" aria-label="Change sort order" className="w-auto min-w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="desc">Newest first</SelectItem>
                  <SelectItem value="asc">Oldest first</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <Card className="overflow-hidden py-0">
            {changes.length === 0 ? (
              <EmptyState
                icon={CircleCheckIcon}
                title={changesList.total === 0 ? "No recorded changes" : "No changes on this page"}
                description={
                  changesList.total === 0
                    ? active
                      ? "Changes appear here as the run writes them."
                      : "This run did not modify the catalog."
                    : "Try another page or clear the action filter."
                }
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    {/* entityName is resolved read-time (not SQL-sortable) —
                        plain head; it does carry the hover summary (T062). */}
                    <TableHead className="pl-4">Entity</TableHead>
                    <SortableTableHead sortKey="entityType" sort={changesList.sort} order={changesList.order} onSortChange={changesList.onSortChange}>Type</SortableTableHead>
                    <SortableTableHead sortKey="action" sort={changesList.sort} order={changesList.order} onSortChange={changesList.onSortChange}>Action</SortableTableHead>
                    <SortableTableHead sortKey="actor" sort={changesList.sort} order={changesList.order} onSortChange={changesList.onSortChange}>Actor</SortableTableHead>
                    <SortableTableHead sortKey="createdAt" sort={changesList.sort} order={changesList.order} onSortChange={changesList.onSortChange} className="pr-4">Time</SortableTableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {changes.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="max-w-56 pl-4 text-sm">
                        <TitleWithSummary
                          className="min-w-0"
                          title={<span className="block truncate font-medium">{c.entityName}</span>}
                          titleText={c.entityName}
                          summary={runChangeSummary(c)}
                          focusable
                        />
                      </TableCell>
                      <TableCell className="text-sm capitalize text-muted-foreground">{c.entityKind}</TableCell>
                      <TableCell>
                        <StatusBadge tone={CHANGE_TONE[c.action] ?? "neutral"} label={c.action.charAt(0).toUpperCase() + c.action.slice(1)} />
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{c.actor}</TableCell>
                      <TableCell className="pr-4 text-sm text-muted-foreground">
                        <RelativeTime iso={c.at} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
          {changesList.total > 0 && (
            <ListPagination
              page={changesList.page}
              pageSize={changesList.pageSize}
              total={changesList.total}
              pageCount={changesList.pageCount}
              onPageChange={changesList.onPageChange}
              onPageSizeChange={changesList.onPageSizeChange}
            />
          )}
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
