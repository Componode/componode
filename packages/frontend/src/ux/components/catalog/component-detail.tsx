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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ux/components/ui/tabs"
import { useValidatedTab } from "@/ux/lib/use-validated-tab"
import { ComponentEditDialog } from "@/ux/components/catalog/component-edit-dialog"
import {
  EngineDetailsSection,
  hasInstanceDetails,
  ImageDetailsSection,
  InstanceDetails,
  NetworkDetailsSection,
  VolumeDetailsSection,
} from "@/ux/components/catalog/docker-details"
import { ComponentRelationshipsPanel } from "@/ux/components/catalog/component-relationships"
import { UrlChecksCard } from "@/ux/components/catalog/url-checks-card"
import type { Component } from "@/ux/lib/view-types"
import { ux } from "@/ux/lib/paths"
import { cn } from "@/ux/lib/utils"

const TABS = ["overview", "relationships"] as const

export function ComponentDetail({ component: c }: { component: Component }) {
  const [tab, setTab] = useValidatedTab(TABS)
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

      <Tabs value={tab} onValueChange={(v) => setTab(v as (typeof TABS)[number])} className="gap-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          {flags.componentRelationships && (
            <TabsTrigger value="relationships">Relationships</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="overview">
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
                const hasDetails = hasInstanceDetails(i);
                const open = expanded.has(i.id);
                return (
                  <React.Fragment key={i.id}>
                    <TableRow>
                      <TableCell className="pl-6">
                        <span className="inline-flex items-center gap-1">
                          {hasDetails ? (
                            <Button
                              variant="ghost"
                              size="icon-xs"
                              aria-label={open ? "Hide details" : "Show details"}
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
                    {open && hasDetails ? (
                      <TableRow className="bg-muted/20 hover:bg-muted/20">
                        <TableCell colSpan={6} className="px-10 py-4">
                          <InstanceDetails instance={i} />
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
          <CardContent className="space-y-6">
            <DescriptionList
              className="sm:grid-cols-1"
              items={[
                { label: "Resource type", value: <code className="font-mono text-xs">{c.resourceType}</code> },
                {
                  label: "Groups",
                  value:
                    c.componentGroups.length > 0 ? (
                      <span className="flex flex-wrap gap-x-2 gap-y-0.5">
                        {c.componentGroups.map((g) => (
                          <a key={g.id} href={ux(`/component-groups/${g.slug}`)} className="text-primary hover:underline">
                            {g.name}
                          </a>
                        ))}
                      </span>
                    ) : (
                      "—"
                    ),
                },
                { label: "Owning team", value: c.teamOwnerName ?? "Unowned" },
                { label: "Sunset", value: c.sunsetAt ? formatDate(c.sunsetAt) : "Not scheduled" },
                { label: "Last seen", value: <RelativeTime iso={c.lastSeenAt} /> },
              ]}
            />
            {c.resourceType === "docker-engine" ? (
              <EngineDetailsSection details={c.details} />
            ) : null}
            {c.resourceType === "image" ? (
              <ImageDetailsSection details={c.details} />
            ) : null}
            {c.resourceType === "network" ? (
              <NetworkDetailsSection details={c.details} />
            ) : null}
            {c.resourceType === "volume" ? (
              <VolumeDetailsSection details={c.details} />
            ) : null}
          </CardContent>
        </Card>
        <UrlChecksCard component={c} />
      </div>
        </TabsContent>

        {flags.componentRelationships && (
          <TabsContent value="relationships">
            <ComponentRelationshipsPanel componentId={c.id} />
          </TabsContent>
        )}
      </Tabs>
    </PageContainer>
  )
}
