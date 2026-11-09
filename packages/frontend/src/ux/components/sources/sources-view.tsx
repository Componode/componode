import { DatabaseIcon, InfoIcon } from "lucide-react"
import { SourcesTable } from "@/ux/components/sources/sources-table"
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header"
import { EmptyState } from "@/ux/components/patterns/states"
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert"
import { Card } from "@/ux/components/ui/card"
import type { PaginationMeta } from "@/api/types"
import type { ImporterSourcesFilterKey, ImporterSourcesSortKey } from "@/api/hooks/importer-sources"
import type { ListState } from "@/ux/hooks/use-list-state"
import type { ImporterSource } from "@/ux/lib/view-types"

export function SourcesView({
  sources: rows,
  pagination,
  list,
}: {
  sources: ImporterSource[]
  pagination?: PaginationMeta
  list: ListState<ImporterSourcesSortKey, ImporterSourcesFilterKey>
}) {
  const unfiltered = !list.search && list.filters.status === "all" && list.filters.importerName === "all"

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
      {/* Fleet-wide status counts can't be computed from one page — the
          status filter + server totals carry that signal now (spec 068). */}
      {rows.length === 0 && unfiltered ? (
        <Card className="py-0">
          <EmptyState
            icon={DatabaseIcon}
            title="No importer sources yet"
            description="Sources appear automatically when an importer that reports source identity completes a run (e.g. the Docker importer on an Import Agent)."
          />
        </Card>
      ) : (
        <SourcesTable rows={rows} list={list} pagination={pagination} />
      )}
    </PageContainer>
  )
}
