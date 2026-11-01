import * as React from "react"
import { GlobeIcon, Trash2Icon } from "lucide-react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { useSession } from "@/api/hooks/auth"
import { useDeleteUrlCheck, useUpdateUrlCheck, useUrlCheckObservations, useUrlChecks } from "@/api/hooks/url-checks"
import { mapMonitoringSetup, mapUrlCheckListItem, mapUrlCheckObservation } from "@/api/mappers/monitoring"
import { ConfirmDialog } from "@/ux/components/patterns/confirm-dialog"
import { RelativeTime } from "@/ux/components/patterns/primitives"
import { CheckStatusBadge, EnvironmentBadge } from "@/ux/components/patterns/status-badge"
import { EmptyState, ErrorState, TableSkeleton } from "@/ux/components/patterns/states"
import { Button } from "@/ux/components/ui/button"
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/ux/components/ui/card"
import { Switch } from "@/ux/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ux/components/ui/tooltip"
import { CHECK_ERROR_TYPE_LABELS } from "@/ux/lib/domain"
import { canAccess } from "@/ux/lib/nav"
import { ux } from "@/ux/lib/paths"
import type { Component, UrlCheckObservationView, UrlCheckView } from "@/ux/lib/view-types"
import { cn } from "@/ux/lib/utils"
import { MonitoringSetupEditor } from "./monitoring-setup-editor"
import { UrlCheckEditor } from "./url-check-editor"

const OUTCOME_DOT: Record<UrlCheckObservationView["outcome"], string> = {
  SUCCESS: "bg-success",
  FAILURE: "bg-destructive",
  MISSED: "bg-warning",
}

/**
 * One dot per observation, oldest → newest. Shared by the card rows and the
 * check detail's recent-outcomes strip.
 */
export function OutcomeDots({ observations, label }: { observations: UrlCheckObservationView[]; label: string }) {
  if (observations.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>
  }
  return (
    <div className="flex h-4 items-center gap-0.5" role="img" aria-label={label}>
      {observations.map((o) => (
        <Tooltip key={o.id}>
          <TooltipTrigger asChild>
            <span className={cn("size-2.5 rounded-full", OUTCOME_DOT[o.outcome])} />
          </TooltipTrigger>
          <TooltipContent>
            {o.outcome === "SUCCESS" ? "Success" : o.outcome === "FAILURE" ? "Failure" : "Missed"}
            {o.httpStatus != null ? ` · ${o.httpStatus}` : ""}
            {o.durationMs != null ? ` · ${o.durationMs} ms` : ""}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  )
}

/** Mini recent-outcome strip per check row — latest ~12 observations. */
function RecentOutcomes({ check }: { check: UrlCheckView }) {
  const obs = useUrlCheckObservations(check.id, 12)
  const list = React.useMemo(
    () => (obs.data?.pages.flatMap((p) => p.observations) ?? []).map(mapUrlCheckObservation).reverse(),
    [obs.data],
  )
  if (obs.isPending) return <span className="text-xs text-muted-foreground">…</span>
  return <OutcomeDots observations={list} label={`Recent outcomes for ${check.name}`} />
}

function CheckRow({
  component,
  check,
  setup,
  canEdit,
}: {
  component: Component
  check: UrlCheckView
  setup: ReturnType<typeof mapMonitoringSetup> | null
  canEdit: boolean
}) {
  const update = useUpdateUrlCheck()
  const del = useDeleteUrlCheck()
  const instance = component.instances.find((i) => i.id === check.componentInstanceId)
  const latest = check.latest

  return (
    <TableRow>
      <TableCell className="pl-6">
        <div className="flex min-w-0 flex-col">
          <Link
            to={ux(`/components/${component.slug}/checks/${check.id}`)}
            className="truncate font-medium underline-offset-4 hover:underline"
          >
            {check.name}
          </Link>
          <code className="max-w-64 truncate font-mono text-xs text-muted-foreground" title={check.url}>
            {check.url}
          </code>
        </div>
      </TableCell>
      <TableCell>{instance ? <EnvironmentBadge value={instance.environment} /> : "—"}</TableCell>
      <TableCell>
        <CheckStatusBadge value={check.status} vantageLabel={setup?.vantageLabel} />
      </TableCell>
      <TableCell>
        {latest ? (
          <span className="inline-flex flex-col">
            <code className="font-mono text-xs">
              {latest.httpStatus != null ? latest.httpStatus : "—"}
            </code>
            {latest.errorType && (
              <span className="text-xs text-muted-foreground">
                {CHECK_ERROR_TYPE_LABELS[latest.errorType] ?? latest.errorType}
              </span>
            )}
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-sm text-muted-foreground">
        <RelativeTime iso={latest?.scheduledAt ?? null} />
      </TableCell>
      <TableCell>
        <RecentOutcomes check={check} />
      </TableCell>
      {canEdit && (
        <TableCell className="pr-6">
          <div className="flex items-center justify-end gap-1">
            <Switch
              checked={check.enabled}
              aria-label={check.enabled ? `Disable ${check.name}` : `Enable ${check.name}`}
              disabled={update.isPending}
              onCheckedChange={(v) =>
                update.mutate(
                  { id: check.id, enabled: v },
                  {
                    onSuccess: () => toast.success(v ? `${check.name} enabled` : `${check.name} disabled`),
                    onError: (e) => toast.error(e.message),
                  },
                )
              }
            />
            <UrlCheckEditor component={component} check={check} setup={setup} />
            <ConfirmDialog
              trigger={
                <Button variant="ghost" size="icon-xs" aria-label={`Delete ${check.name}`}>
                  <Trash2Icon className="size-3.5" />
                </Button>
              }
              title={`Delete ${check.name}?`}
              description="The check definition and its observation history are removed. This cannot be undone."
              confirmLabel="Delete check"
              onConfirm={() =>
                del.mutate(check.id, {
                  onSuccess: () => toast.success(`${check.name} deleted`),
                  onError: (e) => toast.error(e.message),
                })
              }
            />
          </div>
        </TableCell>
      )}
    </TableRow>
  )
}

/**
 * URL checks on the component detail grid (spec 051 US1/US3): one row per
 * check with status, latest result, and a recent-outcome strip. Check status
 * is rendered distinct from instance health — monitoring never overwrites
 * importer-reported state (FR-016/FR-024).
 */
export function UrlChecksCard({ component }: { component: Component }) {
  const query = useUrlChecks(component.id)
  const session = useSession()
  const canEdit = canAccess(session.data?.role ?? "VIEWER", "EDITOR")
  const hasInstances = component.instances.length > 0

  const setup = query.data?.setup ? mapMonitoringSetup(query.data.setup) : null
  const checks = (query.data?.checks ?? []).map(mapUrlCheckListItem)
  const canAdd = canEdit && hasInstances

  return (
    <Card className="lg:col-span-3 overflow-hidden pb-0">
      <CardHeader>
        <CardTitle>URL checks</CardTitle>
        <CardDescription>
          Scheduled HTTP(S) probes — {setup ? `every ${setup.cadenceSeconds} seconds, reachable from ${setup.vantageLabel}` : "not configured yet"}.
          Check status is independent of the importer-reported instance status.
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          {canEdit && <MonitoringSetupEditor componentId={component.id} setup={setup} />}
          {canAdd && <UrlCheckEditor component={component} setup={setup} />}
        </CardAction>
      </CardHeader>
      {query.isPending ? (
        <TableSkeleton rows={3} columns={6} />
      ) : query.isError ? (
        <div className="p-4">
          <ErrorState description="We couldn't load this component's URL checks." onRetry={() => void query.refetch()} />
        </div>
      ) : checks.length === 0 ? (
        <div className="p-4">
          <EmptyState
            icon={GlobeIcon}
            title="No URL checks yet"
            description={
              hasInstances
                ? "Add a check to probe an endpoint on a schedule and track availability and latency — phrased as “reachable from” the vantage."
                : "Checks attach to a component instance — this component has none yet."
            }
            action={canAdd ? <UrlCheckEditor component={component} setup={setup} /> : undefined}
          />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <TableHead className="pl-6">Check</TableHead>
              <TableHead>Instance</TableHead>
              <TableHead>Check status</TableHead>
              <TableHead>Latest</TableHead>
              <TableHead>Last checked</TableHead>
              <TableHead>Recent</TableHead>
              {canEdit && <TableHead className="pr-6 text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {checks.map((c) => (
              <CheckRow key={c.id} component={component} check={c} setup={setup} canEdit={canEdit} />
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  )
}
