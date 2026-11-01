import { CalendarClockIcon, ChevronDownIcon, HistoryIcon, PencilIcon } from "lucide-react"
import * as React from "react"
import { Link } from "react-router-dom"
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header"
import { DescriptionList, MonoValue, RelativeTime } from "@/ux/components/patterns/primitives"
import { ProviderMark } from "@/ux/components/patterns/provider-mark"
import { EnvironmentBadge, HealthBadge, LifecycleBadge } from "@/ux/components/patterns/status-badge"
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert"
import { Badge } from "@/ux/components/ui/badge"
import { Button } from "@/ux/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/ux/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table"
import { CATEGORY_LABELS, PROVIDER_META } from "@/ux/lib/domain"
import { flags } from "@/ux/lib/flags"
import { formatDate } from "@/ux/lib/format"
import { ComponentEditDialog } from "@/ux/components/catalog/component-edit-dialog"
import { UrlChecksCard } from "@/ux/components/catalog/url-checks-card"
import type { Component, ComponentInstance } from "@/ux/lib/view-types"
import { ux } from "@/ux/lib/paths"
import { cn } from "@/ux/lib/utils"

/** Allowlisted `rawConfig.dockerObservation` shape (ADR-121 A1) — loosely
 *  typed on purpose: unknown importers simply don't set it. */
interface DockerObservation {
  state?: string;
  exitCode?: number;
  oomKilled?: boolean;
  restarting?: boolean;
  startedAt?: string | null;
  finishedAt?: string | null;
  health?: { status?: string; failingStreak?: number } | null;
}

function dockerObservationOf(i: ComponentInstance): DockerObservation | null {
  const o = i.rawConfig?.dockerObservation;
  return o && typeof o === "object" ? (o as DockerObservation) : null;
}

function ObservationDetails({ obs }: { obs: DockerObservation }) {
  const health = obs.health ?? null;
  return (
    <DescriptionList
      className="sm:grid-cols-[minmax(10rem,auto)_1fr]"
      items={[
        { label: "Observed state", value: <code className="font-mono text-xs">{obs.state ?? "unknown"}</code> },
        {
          label: "Health check",
          value: health ? (
            <Badge
              variant={health.status === "unhealthy" ? "destructive" : "secondary"}
              className="font-mono"
            >
              {health.status}
              {health.failingStreak ? ` ×${health.failingStreak}` : ""}
            </Badge>
          ) : (
            <span className="text-muted-foreground">No health check configured</span>
          ),
        },
        ...(obs.exitCode !== undefined
          ? [{ label: "Exit code", value: <code className="font-mono text-xs">{obs.exitCode}</code> }]
          : []),
        ...(obs.oomKilled ? [{ label: "OOM killed", value: "Yes" }] : []),
        ...(obs.restarting ? [{ label: "Restarting", value: "Yes" }] : []),
        { label: "Started", value: <RelativeTime iso={obs.startedAt ?? null} /> },
        { label: "Finished", value: <RelativeTime iso={obs.finishedAt ?? null} /> },
      ]}
    />
  );
}

export function ComponentDetail({ component: c }: { component: Component }) {
  const [expanded, setExpanded] = React.useState<ReadonlySet<string>>(new Set());
  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const overdue = c.sunsetAt && new Date(c.sunsetAt) < new Date()
  return (
    <PageContainer>
      <PageHeader
        media={<ProviderMark provider={c.provider} size="lg" />}
        title={<span className="font-mono">{c.name}</span>}
        description={`${CATEGORY_LABELS[c.category] ?? c.category} on ${PROVIDER_META[c.provider].label}`}
        meta={
          <>
            <LifecycleBadge value={c.lifecycle} />
            {c.tags.map((t) => (
              <Badge key={t} variant="secondary" className="font-mono">
                #{t}
              </Badge>
            ))}
          </>
        }
        actions={
          <>
            <ComponentEditDialog component={c} />
            <Button variant="outline" asChild>
              <Link to={ux(`/components/${c.slug}/history`)}>
                <HistoryIcon data-icon="inline-start" />
                History
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to={ux(`/components/${c.slug}/promote`)}>
                <PencilIcon data-icon="inline-start" />
                Promote to platform
              </Link>
            </Button>
          </>
        }
      />

      {overdue && (
        <Alert variant="destructive">
          <CalendarClockIcon />
          <AlertTitle>Sunset date passed on {formatDate(c.sunsetAt as string)}</AlertTitle>
          <AlertDescription>Retire the component or extend its sunset date.</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2 overflow-hidden pb-0">
          <CardHeader>
            <CardTitle>Instances</CardTitle>
            <CardDescription>One row per environment the importer observed. Instances reported gone are hidden here.</CardDescription>
            <CardAction>
              <Button variant="outline" size="sm" disabled={!flags.detailGoneInstances} title="Showing gone instances here needs detail-level API support (gap G26)">
                Show gone
              </Button>
            </CardAction>
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-6">Environment</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Version</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>External ID</TableHead>
                <TableHead className="pr-6 text-right">Last seen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {c.instances.map((i) => {
                const obs = dockerObservationOf(i);
                const open = expanded.has(i.id);
                return (
                  <React.Fragment key={i.id}>
                    <TableRow>
                      <TableCell className="pl-6">
                        <span className="inline-flex items-center gap-1">
                          {obs ? (
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label={open ? "Hide observation" : "Show observation"}
                              aria-expanded={open}
                              onClick={() => toggle(i.id)}
                            >
                              <ChevronDownIcon
                                className={cn("size-4 transition-transform", open && "rotate-180")}
                                aria-hidden="true"
                              />
                            </Button>
                          ) : null}
                          <EnvironmentBadge value={i.environment} />
                        </span>
                      </TableCell>
                      <TableCell>
                        <HealthBadge value={i.status} />
                      </TableCell>
                      <TableCell className="font-mono text-xs">{i.version ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{i.region ?? "—"}</TableCell>
                      <TableCell className="max-w-56">
                        <MonoValue value={i.externalId} />
                      </TableCell>
                      <TableCell className="pr-6 text-right text-sm text-muted-foreground">
                        <RelativeTime iso={i.lastSeenAt} />
                      </TableCell>
                    </TableRow>
                    {open && obs ? (
                      <TableRow className="bg-muted/20 hover:bg-muted/20">
                        <TableCell colSpan={6} className="px-10 py-4">
                          <ObservationDetails obs={obs} />
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </React.Fragment>
                );
              })}
            </TableBody>
          </Table>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <DescriptionList
              className="sm:grid-cols-1"
              items={[
                { label: "Resource type", value: <code className="font-mono text-xs">{c.resourceType}</code> },
                { label: "Group", value: c.componentGroupName ?? "—" },
                { label: "Owning team", value: c.teamOwnerName ?? "Unowned" },
                { label: "Sunset", value: c.sunsetAt ? formatDate(c.sunsetAt) : "Not scheduled" },
                { label: "Last seen", value: <RelativeTime iso={c.lastSeenAt} /> },
              ]}
            />
          </CardContent>
        </Card>
        <UrlChecksCard component={c} />
      </div>
    </PageContainer>
  )
}
