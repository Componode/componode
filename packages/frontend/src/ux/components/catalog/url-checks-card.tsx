import * as React from "react";
import { GlobeIcon, PlugZapIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { useSession } from "@/api/hooks/auth";
import { useUrlChecks } from "@/api/hooks/url-checks";
import {
  mapMonitoringSetup,
  mapUrlCheckListItem,
} from "@/api/mappers/monitoring";
import { RelativeTime } from "@/ux/components/patterns/primitives";
import {
  CheckStatusBadge,
  EnvironmentBadge,
} from "@/ux/components/patterns/status-badge";
import {
  EmptyState,
  ErrorState,
  TableSkeleton,
} from "@/ux/components/patterns/states";
import { Badge } from "@/ux/components/ui/badge";
import {
  Card,
  CardAction,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/ux/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ux/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/ux/components/ui/tooltip";
import { CHECK_ERROR_TYPE_LABELS } from "@/ux/lib/domain";
import { formatMs, formatPct } from "@/ux/lib/format";
import { canAccess } from "@/ux/lib/nav";
import { ux } from "@/ux/lib/paths";
import type {
  Component,
  UrlCheckObservationView,
  UrlCheckView,
} from "@/ux/lib/view-types";
import { cn } from "@/ux/lib/utils";
import { ComponentInstanceCreateDialog } from "./component-instance-create-dialog";
import { MonitoringSetupEditor } from "./monitoring-setup-editor";

const OUTCOME_DOT: Record<UrlCheckObservationView["outcome"], string> = {
  SUCCESS: "bg-success",
  FAILURE: "bg-destructive",
  MISSED: "bg-warning",
};

const pct = formatPct;
const ms = formatMs;

/**
 * One dot per observation, oldest → newest. Shared by the card rows and the
 * check detail's recent-outcomes strip.
 */
export function OutcomeDots({
  observations,
  label,
}: {
  observations: UrlCheckObservationView[];
  label: string;
}) {
  if (observations.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  return (
    <div
      className="flex h-4 items-center gap-0.5"
      role="img"
      aria-label={label}
    >
      {observations.map((o) => (
        <Tooltip key={o.id}>
          <TooltipTrigger asChild>
            <span
              className={cn("size-2.5 rounded-full", OUTCOME_DOT[o.outcome])}
            />
          </TooltipTrigger>
          <TooltipContent>
            {o.outcome === "SUCCESS"
              ? "Success"
              : o.outcome === "FAILURE"
                ? "Failure"
                : "Missed"}
            {o.httpStatus != null ? ` · ${o.httpStatus}` : ""}
            {o.durationMs != null ? ` · ${o.durationMs} ms` : ""}
          </TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}

/** Mini recent-outcome strip per check row — the ≤12 latest observations
 *  ride the bounded list payload (spec 053 US2), no per-row requests. */
function RecentOutcomes({ check }: { check: UrlCheckView }) {
  const list = React.useMemo(() => [...check.recent].reverse(), [check.recent]);
  return (
    <OutcomeDots
      observations={list}
      label={`Recent outcomes for ${check.name}`}
    />
  );
}

/** Compact 24h availability cell — missed slots stay distinguishable from
 *  endpoint failures via a warning annotation (spec 053 US3, FR-006). */
function AvailabilityCell({ check }: { check: UrlCheckView }) {
  const { summary } = check;
  if (summary.availability === null) {
    return <span className="text-sm text-muted-foreground">No data yet</span>;
  }
  return (
    <span className="inline-flex flex-col">
      <span className="tabular text-sm">{pct(summary.availability)}</span>
      {summary.counts.missed > 0 && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-xs text-warning">
              · {summary.counts.missed} missed
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {summary.counts.missed} scheduled probe
            {summary.counts.missed === 1 ? "" : "s"} did not run in this window
            (coverage gap — monitor-side downtime counts as unavailable).
          </TooltipContent>
        </Tooltip>
      )}
    </span>
  );
}

/** Compact 24h p95 cell — "—" when the window has no successful timed
 *  responses; "No data yet" only when nothing was scheduled. */
function LatencyCell({ check }: { check: UrlCheckView }) {
  if (check.summary.availability === null) {
    return <span className="text-sm text-muted-foreground">No data yet</span>;
  }
  return <span className="tabular text-sm">{ms(check.summary.p95)}</span>;
}

function CheckRow({
  component,
  check,
  setup,
}: {
  component: Component;
  check: UrlCheckView;
  setup: ReturnType<typeof mapMonitoringSetup> | null;
}) {
  const instance = component.instances.find(
    (i) => i.id === check.componentInstanceId,
  );
  const latest = check.latest;

  return (
    <TableRow>
      <TableCell className="pl-6">
        <div className="flex min-w-0 flex-col">
          <span className="flex min-w-0 items-center gap-2">
            <Link
              to={ux(`/components/${component.slug}/checks/${check.id}`)}
              className="truncate font-medium underline-offset-4 hover:underline"
            >
              {check.name}
            </Link>
            {check.managedKey ? (
              check.managedByConfigId ? (
                <Link
                  to={ux(`/importers/${check.managedByConfigId}`)}
                  title="Managed by an importer — edit the check on its ImporterConfig"
                >
                  <Badge variant="secondary" className="gap-1">
                    <PlugZapIcon className="size-3" />
                    Managed
                  </Badge>
                </Link>
              ) : (
                <Badge variant="secondary" className="gap-1" title="Managed by an importer">
                  <PlugZapIcon className="size-3" />
                  Managed
                </Badge>
              )
            ) : (
              <Badge variant="outline" title="Legacy check — retained read-only">
                Legacy
              </Badge>
            )}
          </span>
          <code
            className="max-w-64 truncate font-mono text-xs text-muted-foreground"
            title={check.url}
          >
            {check.url}
          </code>
        </div>
      </TableCell>
      <TableCell>
        {instance ? <EnvironmentBadge value={instance.environment} /> : "—"}
      </TableCell>
      <TableCell>
        <CheckStatusBadge
          value={check.status}
          vantageLabel={setup?.vantageLabel}
        />
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
        <AvailabilityCell check={check} />
      </TableCell>
      <TableCell>
        <LatencyCell check={check} />
      </TableCell>
      <TableCell>
        <RecentOutcomes check={check} />
      </TableCell>
      <TableCell className="pr-6 text-right text-sm text-muted-foreground">
        {check.managedKey ? "Read-only — managed by importer" : "Read-only"}
      </TableCell>
    </TableRow>
  );
}

/**
 * URL checks on the component detail grid (spec 051 US1/US3): one row per
 * check with status, latest result, and a recent-outcome strip. Managed
 * checks drive the monitored instance's status (spec 058 FR-014) — the
 * card is read-only; definitions live on the owning ImporterConfig.
 */
export function UrlChecksCard({ component }: { component: Component }) {
  const query = useUrlChecks(component.id);
  const session = useSession();
  const role = session.data?.role ?? "VIEWER";
  const canConfigure = canAccess(role, "EDITOR");
  const hasInstances = component.instances.length > 0;

  const setup = query.data?.setup ? mapMonitoringSetup(query.data.setup) : null;
  const checks = (query.data?.checks ?? []).map(mapUrlCheckListItem);
  const totalInstances =
    component.totalInstanceCount ?? component.instances.length;
  const canRecover =
    canConfigure && totalInstances === 0 && component.lifecycle === "ACTIVE";

  return (
    <Card className="lg:col-span-3 overflow-hidden pb-0">
      <CardHeader>
        <CardTitle>URL checks</CardTitle>
        <CardDescription>
          Scheduled HTTP(S) probes —{" "}
          {setup
            ? `every ${setup.cadenceSeconds} seconds, reachable from ${setup.vantageLabel}`
            : "not configured yet"}
          . Checks are declared by the owning ImporterConfig and their results
          drive the monitored instance status.
        </CardDescription>
        <CardAction className="flex items-center gap-2">
          {canConfigure && (
            <MonitoringSetupEditor componentId={component.id} setup={setup} />
          )}
          {canRecover && (
            <ComponentInstanceCreateDialog component={component} />
          )}
        </CardAction>
      </CardHeader>
      {query.isPending ? (
        <TableSkeleton rows={3} columns={8} />
      ) : query.isError ? (
        <div className="p-4">
          <ErrorState
            description="We couldn't load this component's URL checks."
            onRetry={() => void query.refetch()}
          />
        </div>
      ) : checks.length === 0 ? (
        <div className="p-4">
          <EmptyState
            icon={GlobeIcon}
            title="No URL checks yet"
            description={
              hasInstances
                ? "URL checks are declared by an importer's ImporterConfig — they appear here after a run syncs the managed definitions."
                : "Checks attach to a component instance — this component has none yet."
            }
            action={
              canRecover ? (
                <ComponentInstanceCreateDialog component={component} />
              ) : undefined
            }
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
              <TableHead>Availability (24h)</TableHead>
              <TableHead>p95 (24h)</TableHead>
              <TableHead>Recent</TableHead>
              <TableHead className="pr-6 text-right">Authoring</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {checks.map((c) => (
              <CheckRow
                key={c.id}
                component={component}
                check={c}
                setup={setup}
              />
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
