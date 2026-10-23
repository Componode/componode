import { CalendarClockIcon, HistoryIcon, PencilIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header"
import { DescriptionList, MonoValue, RelativeTime } from "@/ux/components/patterns/primitives"
import { ProviderMark } from "@/ux/components/patterns/provider-mark"
import { EnvironmentBadge, HealthBadge, LifecycleBadge } from "@/ux/components/patterns/status-badge"
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert"
import { Badge } from "@/ux/components/ui/badge"
import { Button } from "@/ux/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ux/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table"
import { CATEGORY_LABELS, PROVIDER_META } from "@/ux/lib/domain"
import { formatDate } from "@/ux/lib/format"
import type { Component } from "@/ux/lib/view-types"
import { ux } from "@/ux/lib/paths"

export function ComponentDetail({ component: c }: { component: Component }) {
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
            <CardDescription>One row per environment the importer observed. Gone instances are kept for 30 days.</CardDescription>
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
              {c.instances.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="pl-6">
                    <EnvironmentBadge value={i.environment} />
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
              ))}
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
      </div>
    </PageContainer>
  )
}
