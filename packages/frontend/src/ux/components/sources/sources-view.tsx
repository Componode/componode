import { DatabaseIcon, InfoIcon } from "lucide-react"
import { SourcesTable } from "@/ux/components/sources/sources-table"
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header"
import { EmptyState } from "@/ux/components/patterns/states"
import { Summary } from "@/ux/components/patterns/summary-card"
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert"
import { Card } from "@/ux/components/ui/card"
import type { ImporterSource } from "@/ux/lib/view-types"

export function SourcesView({ sources: rows }: { sources: ImporterSource[] }) {
  const active = rows.filter((s) => s.status === "ACTIVE").length
  const unmonitored = rows.filter((s) => s.status === "UNMONITORED").length
  const retired = rows.filter((s) => s.status === "RETIRED").length

  return (
    <PageContainer>
      <PageHeader
        title="Importer sources"
        description="The durable provenance record behind each import — the external system an importer reports, which config feeds it, and what it owns in the catalog."
      />
      <Alert>
        <InfoIcon />
        <AlertTitle>Sources are matched by provider identity</AlertTitle>
        <AlertDescription>
          A source reattaches automatically when a config reporting the same provider identity completes a run — never by name or manual selection.
        </AlertDescription>
      </Alert>
      {rows.length === 0 ? (
        <Card className="py-0">
          <EmptyState
            icon={DatabaseIcon}
            title="No importer sources yet"
            description="Sources appear automatically when an importer that reports source identity completes a run (e.g. the Docker importer on an Import Agent)."
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Summary label="Active" value={active} hint="A bound config is feeding them" />
            <Summary label="Unmonitored" value={unmonitored} hint="No config feeds them right now" />
            <Summary label="Retired" value={retired} hint="Excluded until reactivated" />
          </div>
          <SourcesTable rows={rows} />
        </>
      )}
    </PageContainer>
  )
}
