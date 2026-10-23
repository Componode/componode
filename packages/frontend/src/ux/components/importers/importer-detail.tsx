
import { CircleAlertIcon, PlayIcon, Settings2Icon } from "lucide-react"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header"
import { DescriptionList, RelativeTime } from "@/ux/components/patterns/primitives"
import { ProviderMark } from "@/ux/components/patterns/provider-mark"
import { RunStatusBadge } from "@/ux/components/patterns/status-badge"
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert"
import { Button } from "@/ux/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ux/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table"
import { PROVIDER_META } from "@/ux/lib/domain"
import { formatDuration, formatNumber } from "@/ux/lib/format"
import { type ImporterConfig, importRuns } from "@/ux/lib/mock-data"

export function ImporterDetail({ importer: i }: { importer: ImporterConfig }) {
  const failed = i.lastRun?.status === "FAILED"
  const lastError = importRuns.find((r) => r.errorMessage)?.errorMessage
  return (
    <PageContainer>
      <PageHeader
        media={<ProviderMark provider={i.importerName} size="lg" />}
        title={i.label}
        description={`${PROVIDER_META[i.importerName].label} · ${i.scheduleLabel}`}
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={`/importers/${i.id}/edit`}>
                <Settings2Icon data-icon="inline-start" />
                Configure
              </Link>
            </Button>
            <Button onClick={() => toast.success("Run queued")} disabled={!i.enabled}>
              <PlayIcon data-icon="inline-start" />
              Run now
            </Button>
          </>
        }
      />

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
          </CardHeader>
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-6">Status</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead className="text-right">Processed</TableHead>
                <TableHead className="text-right">Created / updated</TableHead>
                <TableHead className="pr-6 text-right">Duration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {importRuns.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="pl-6">
                    <div className="flex flex-col gap-1">
                      <RunStatusBadge value={r.status} />
                      {r.currentPhase && <span className="text-xs text-muted-foreground">{r.currentPhase}</span>}
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">
                    <Link to={`/importers/${i.id}/runs/${r.id}`} className="hover:underline">
                      <RelativeTime iso={r.startedAt} />
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.triggeredBy}</TableCell>
                  <TableCell className="tabular text-right">{formatNumber(r.assetsProcessed)}</TableCell>
                  <TableCell className="tabular text-right text-muted-foreground">
                    +{r.assetsCreated} / ~{r.assetsUpdated}
                  </TableCell>
                  <TableCell className="tabular pr-6 text-right">{formatDuration(r.durationSec)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
              ]}
            />
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  )
}
