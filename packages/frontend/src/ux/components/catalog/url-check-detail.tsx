import { Link } from "react-router-dom";
import {
  useMonitoringSetup,
  useUrlCheck,
  useUrlCheckMetrics,
  useUrlCheckObservations,
} from "@/api/hooks/url-checks";
import {
  checkStatusOf,
  mapMonitoringSetup,
  mapUrlCheck,
  mapUrlCheckMetrics,
  mapUrlCheckObservation,
} from "@/api/mappers/monitoring";
import { OutcomeDots } from "@/ux/components/catalog/url-checks-card";
import { ENVIRONMENT_META } from "@/ux/lib/domain";
import {
  PageContainer,
  PageHeader,
} from "@/ux/components/patterns/page-header";
import {
  DescriptionList,
  RelativeTime,
} from "@/ux/components/patterns/primitives";
import {
  CheckOutcomeBadge,
  CheckStatusBadge,
  EnvironmentBadge,
} from "@/ux/components/patterns/status-badge";
import { NotFoundState, TableSkeleton } from "@/ux/components/patterns/states";
import { Badge } from "@/ux/components/ui/badge";
import { Button } from "@/ux/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/ux/components/ui/card";
import { Skeleton } from "@/ux/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ux/components/ui/table";
import { CHECK_AUTH_MODE_META, CHECK_ERROR_TYPE_LABELS } from "@/ux/lib/domain";
import { formatMs, formatPct } from "@/ux/lib/format";
import { ux } from "@/ux/lib/paths";
import type { Component, UrlCheckMetricsView } from "@/ux/lib/view-types";

const pct = formatPct;
const ms = formatMs;

/** One rolling-window column of counters (Counter pattern from run-detail). */
function MetricColumn({
  metrics,
  isPending,
}: {
  metrics: UrlCheckMetricsView | undefined;
  isPending: boolean;
}) {
  if (isPending) {
    return (
      <div
        className="flex flex-col gap-2 rounded-lg border p-4"
        aria-busy="true"
        aria-label="Loading metrics"
      >
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-28" />
      </div>
    );
  }
  if (!metrics) return null;
  const targetHere =
    metrics.target && metrics.target.window.toLowerCase() === metrics.window;
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Last {metrics.windowLabel}
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="tabular text-2xl font-semibold">
          {pct(metrics.availability)}
        </span>
        <span className="text-xs text-muted-foreground">
          availability — reachable from {metrics.vantageLabel}
        </span>
        {targetHere && (
          <span className="text-xs text-muted-foreground">
            target {metrics.target!.availability}% over{" "}
            {metrics.target!.window === "24H"
              ? "24 hours"
              : metrics.target!.window === "7D"
                ? "7 days"
                : "30 days"}
          </span>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Error rate</dt>
        <dd className="tabular text-right">{pct(metrics.errorRate)}</dd>
        <dt className="text-muted-foreground">p50</dt>
        <dd className="tabular text-right">{ms(metrics.p50)}</dd>
        <dt className="text-muted-foreground">p95</dt>
        <dd className="tabular text-right">{ms(metrics.p95)}</dd>
        <dt className="text-muted-foreground">p99</dt>
        <dd className="tabular text-right">{ms(metrics.p99)}</dd>
        <dt className="text-muted-foreground">Probes</dt>
        <dd className="tabular text-right">
          {metrics.counts.success} ok · {metrics.counts.failure} failed
          {metrics.counts.missed > 0
            ? ` · ${metrics.counts.missed} missed`
            : ""}
        </dd>
      </dl>
      {metrics.counts.missed > 0 && (
        <p className="text-xs text-warning">
          {metrics.counts.missed} scheduled probe
          {metrics.counts.missed === 1 ? "" : "s"} did not run in this window
          (coverage gap — monitor-side downtime counts as unavailable).
        </p>
      )}
    </div>
  );
}

const OUTCOME_STRIP_LEN = 30;

/** env label + optional region so instance rows stay distinguishable. */
function instanceLabel(i: Component["instances"][number]): string {
  const env = ENVIRONMENT_META[i.environment]?.label ?? i.environment;
  return i.region ? `${env} · ${i.region}` : env;
}

export function UrlCheckDetail({
  component,
  checkId,
}: {
  component: Component;
  checkId: string;
}) {
  const checkQuery = useUrlCheck(checkId);
  const setupQuery = useMonitoringSetup(component.id);
  const m24 = useUrlCheckMetrics(checkId, "24h");
  const m7 = useUrlCheckMetrics(checkId, "7d");
  const m30 = useUrlCheckMetrics(checkId, "30d");
  const obs = useUrlCheckObservations(checkId, 25);

  if (checkQuery.isPending) {
    return (
      <PageContainer>
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-6 w-full max-w-xl" />
        <Card className="py-0">
          <TableSkeleton rows={5} columns={4} />
        </Card>
      </PageContainer>
    );
  }

  const apiCheck = checkQuery.data?.check;
  // The slug in the URL must own this check — its instance belongs to the component.
  const belongs =
    apiCheck &&
    component.instances.some((i) => i.id === apiCheck.componentInstanceId);
  if (!apiCheck || !belongs) {
    return (
      <PageContainer>
        <NotFoundState
          title="Check not found"
          description="This check doesn't exist, or it belongs to a different component."
          backHref={ux(`/components/${component.slug}`)}
          backLabel={`Back to ${component.name}`}
        />
      </PageContainer>
    );
  }

  const setup = setupQuery.data?.setup
    ? mapMonitoringSetup(setupQuery.data.setup)
    : null;
  const metrics24 = m24.data ? mapUrlCheckMetrics(m24.data) : undefined;
  const metrics7 = m7.data ? mapUrlCheckMetrics(m7.data) : undefined;
  const metrics30 = m30.data ? mapUrlCheckMetrics(m30.data) : undefined;
  const latest = metrics24?.latest ?? null;
  const vantageLabel = metrics24?.vantageLabel ?? setup?.vantageLabel ?? "Hub";
  const check = mapUrlCheck(apiCheck, latest);
  const status = checkStatusOf({
    enabled: check.enabled,
    autoDisabledAt: check.autoDisabledAt,
    latest,
  });
  const instance = component.instances.find(
    (i) => i.id === check.componentInstanceId,
  );

  const observations = (
    obs.data?.pages.flatMap((p) => p.observations) ?? []
  ).map(mapUrlCheckObservation);
  const strip = observations.slice(0, OUTCOME_STRIP_LEN).reverse();

  const cadence = check.cadenceSeconds ?? setup?.cadenceSeconds ?? null;
  const metricErr = m24.error ?? m7.error ?? m30.error;

  return (
    <PageContainer>
      <PageHeader
        title={<span className="font-mono">{check.name}</span>}
        description={
          <>
            <code className="font-mono text-foreground">{check.url}</code> ·{" "}
            {check.method} · reachable from {vantageLabel} — a URL check is not
            the instance&apos;s importer-reported status.
          </>
        }
        meta={
          <>
            <CheckStatusBadge value={status} vantageLabel={vantageLabel} />
            {check.authMode !== "NONE" && (
              <Badge variant="secondary">
                {CHECK_AUTH_MODE_META[check.authMode].label}
              </Badge>
            )}
            {check.availabilityTarget != null && check.targetWindow != null && (
              <Badge variant="secondary">
                target {check.availabilityTarget}% / {check.targetWindow}
              </Badge>
            )}
            {check.autoDisabledAt && (
              <Badge variant="secondary">
                auto-disabled after {check.consecutiveFailures} consecutive
                failures · <RelativeTime iso={check.autoDisabledAt} />
              </Badge>
            )}
            {check.managedKey ? (
              check.managedByConfigId ? (
                <Link
                  to={ux(`/importers/${check.managedByConfigId}`)}
                  title="Managed by an importer — edit the check on its ImporterConfig"
                >
                  <Badge variant="secondary" className="gap-1">Managed</Badge>
                </Link>
              ) : (
                <Badge variant="secondary" title="Managed by an importer">
                  Managed
                </Badge>
              )
            ) : (
              <Badge
                variant="secondary"
                title="Created before importer-managed checks — kept read-only and disabled"
              >
                Legacy
              </Badge>
            )}
          </>
        }
      />

      <Card>
        <CardHeader>
          <CardTitle>Availability &amp; latency</CardTitle>
          <CardDescription>
            Rolling 24-hour, 7-day, and 30-day windows — every figure means
            “reachable from {vantageLabel}”, not global availability. Latency is
            request-start to response-headers.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {metricErr ? (
            <p className="text-sm text-destructive">
              Metrics couldn&apos;t be loaded right now.
            </p>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              <MetricColumn metrics={metrics24} isPending={m24.isPending} />
              <MetricColumn metrics={metrics7} isPending={m7.isPending} />
              <MetricColumn metrics={metrics30} isPending={m30.isPending} />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2 overflow-hidden pb-0">
          <CardHeader>
            <CardTitle>Observations</CardTitle>
            <CardDescription>
              One row per scheduled probe — detailed history is retained for 30
              days.
            </CardDescription>
            <CardAction className="flex items-center gap-2">
              <OutcomeDots
                observations={strip}
                label={`Recent outcomes for ${check.name}`}
              />
            </CardAction>
          </CardHeader>
          {obs.isPending ? (
            <TableSkeleton rows={5} columns={5} />
          ) : observations.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              No observations yet — enabled checks record one per scheduled
              probe.
            </p>
          ) : (
            <>
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="pl-6">When</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead className="pr-6">Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {observations.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="pl-6 text-sm text-muted-foreground">
                        <RelativeTime iso={o.scheduledAt} />
                      </TableCell>
                      <TableCell>
                        <CheckOutcomeBadge value={o.outcome} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {o.httpStatus != null ? o.httpStatus : "—"}
                      </TableCell>
                      <TableCell className="tabular text-sm">
                        {o.durationMs != null ? `${o.durationMs} ms` : "—"}
                      </TableCell>
                      <TableCell className="pr-6 text-sm text-muted-foreground">
                        {o.errorType
                          ? (CHECK_ERROR_TYPE_LABELS[o.errorType] ??
                            o.errorType)
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              {obs.hasNextPage && (
                <div className="flex justify-center border-t p-3">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={obs.isFetchingNextPage}
                    onClick={() => void obs.fetchNextPage()}
                  >
                    Load older observations
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <DescriptionList
              className="sm:grid-cols-1"
              items={[
                {
                  label: "Instance",
                  value: instance ? (
                    <span className="inline-flex items-center gap-2">
                      <EnvironmentBadge value={instance.environment} />
                      <span className="text-xs text-muted-foreground">
                        {instanceLabel(instance)}
                      </span>
                    </span>
                  ) : (
                    "—"
                  ),
                },
                {
                  label: "Cadence",
                  value:
                    cadence != null
                      ? `every ${cadence}s${check.cadenceSeconds == null ? " (setup default)" : " (override)"}`
                      : "—",
                },
                {
                  label: "Accepted statuses",
                  value: (
                    <code className="font-mono text-xs">
                      {check.successPolicyLabel}
                    </code>
                  ),
                },
                { label: "Vantage", value: `reachable from ${vantageLabel}` },
                {
                  label: "Auth",
                  value: CHECK_AUTH_MODE_META[check.authMode].label,
                },
                {
                  label: "Next probe",
                  value: <RelativeTime iso={check.nextProbeAt} />,
                },
                {
                  label: "Last checked",
                  value: <RelativeTime iso={latest?.scheduledAt ?? null} />,
                },
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
