
import { CircleAlertIcon, CircleCheckIcon, Loader2Icon, RadioTowerIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { useLocation, useNavigate, useSearchParams } from "react-router-dom"
import * as React from "react"
import { toast } from "sonner"
import { ConfirmDialog } from "@/ux/components/patterns/confirm-dialog"
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header"
import { DescriptionList, MonoValue, RelativeTime } from "@/ux/components/patterns/primitives"
import { ProviderMark } from "@/ux/components/patterns/provider-mark"
import { RunStatusBadge, StatusBadge } from "@/ux/components/patterns/status-badge"
import { EmptyState } from "@/ux/components/patterns/states"
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert"
import { Button } from "@/ux/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ux/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ux/components/ui/tabs"
import { PROVIDER_META, type Tone } from "@/ux/lib/domain"
import { formatDateTime, formatDuration, formatNumber } from "@/ux/lib/format"
import type { ImporterConfig, ImportRun, RunChange, RunError } from "@/ux/lib/mock-data"
import { credentials } from "@/ux/lib/mock-data"

const TABS = ["overview", "errors", "changes"]

const CHANGE_TONE: Record<RunChange["action"], Tone> = {
  created: "success",
  updated: "info",
  orphaned: "warning",
  retired: "neutral",
}

interface RunDetailProps {
  importer: ImporterConfig
  run: ImportRun
  errors: RunError[]
  changes: RunChange[]
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-4">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="tabular text-2xl font-semibold">{formatNumber(value)}</span>
    </div>
  )
}

export function RunDetail({ importer, run: initial, errors, changes }: RunDetailProps) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [searchParams] = useSearchParams()
  const requestedTab = searchParams.get("tab")
  const tab = requestedTab && TABS.includes(requestedTab) ? requestedTab : "overview"

  const [run, setRun] = React.useState(initial)
  const active = run.status === "RUNNING" || run.status === "PENDING"
  const usedCredential = credentials.find((c) => c.slug === importer.credentialLabel)

  const setTab = (value: string) => navigate(`${pathname}?tab=${value}`, { replace: true })

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
            <Link to={`/importers/${importer.id}`} className="font-medium text-foreground hover:underline">
              {importer.label}
            </Link>{" "}
            · {PROVIDER_META[importer.importerName].label} · triggered by {run.triggeredBy}
          </>
        }
        meta={
          <>
            <RunStatusBadge value={run.status} />
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
            <ConfirmDialog
              trigger={<Button variant="outline">Cancel run</Button>}
              title={`Cancel ${run.id}?`}
              description="The importer stops at the end of its current phase. Assets already processed are kept."
              confirmLabel="Cancel run"
              onConfirm={() => {
                setRun((r) => ({ ...r, status: "CANCELLED", durationSec: 0 }))
                toast.success(`${run.id} cancelled`)
              }}
            />
          ) : null
        }
      />

      {run.errorMessage && (
        <Alert variant="destructive">
          <CircleAlertIcon />
          <AlertTitle>{run.status === "FAILED" ? "This run failed" : "This run reported an error"}</AlertTitle>
          <AlertDescription>
            {run.errorMessage}.{" "}
            {usedCredential && (
              <Link to={`/credentials/${usedCredential.id}`} className="font-medium underline underline-offset-4">
                Open credential {usedCredential.label}
              </Link>
            )}
          </AlertDescription>
        </Alert>
      )}
      {run.status === "COMPLETED" && errors.length > 0 && (
        <Alert>
          <CircleAlertIcon />
          <AlertTitle>
            Completed with {errors.length} warning{errors.length === 1 ? "" : "s"}
          </AlertTitle>
          <AlertDescription>Some assets were skipped. Open the Errors tab for the list.</AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="errors">Errors{errors.length > 0 ? ` (${errors.length})` : ""}</TabsTrigger>
          <TabsTrigger value="changes">Changes{changes.length > 0 ? ` (${changes.length})` : ""}</TabsTrigger>
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
                          <Link to={`/agents/${run.agentId}`} className="font-mono font-medium text-primary hover:underline">
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
                        <Link to={`/credentials/${usedCredential.id}`} className="font-medium text-primary hover:underline">
                          {usedCredential.label}
                        </Link>
                      ) : (
                        "None"
                      ),
                    },
                    { label: "Importer", value: <Link to={`/importers/${importer.id}`} className="text-primary hover:underline">{importer.label}</Link> },
                    { label: "Schedule", value: importer.scheduleLabel },
                  ]}
                />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="errors" className="mt-4">
          <Card className="overflow-hidden py-0">
            {errors.length === 0 ? (
              <EmptyState icon={CircleCheckIcon} title="No run errors" description="Nothing was skipped or rejected during this run." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="pl-4">Asset</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Message</TableHead>
                    <TableHead className="pr-4">Time</TableHead>
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
        </TabsContent>

        <TabsContent value="changes" className="mt-4">
          <Card className="overflow-hidden py-0">
            {changes.length === 0 ? (
              <EmptyState
                icon={CircleCheckIcon}
                title="No recorded changes"
                description={active ? "Changes appear here as the run writes them." : "This run did not modify the catalog."}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="pl-4">Entity</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead className="pr-4">Time</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {changes.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="pl-4 text-sm font-medium">{c.entityName}</TableCell>
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
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
