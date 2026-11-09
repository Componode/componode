import {
  IMPORTER_SOURCES_SORT_KEYS,
  importerSourcesListParams,
  useImporterSources,
  type ImporterSourcesFilterKey,
  type ImporterSourcesSortKey,
} from "@/api/hooks/importer-sources";
import { mapImporterSource } from "@/api/mappers/operations";
import { SourcesView } from "@/ux/components/sources/sources-view";
import { PageContainer } from "@/ux/components/patterns/page-header";
import { ErrorState, ForbiddenState, TableSkeleton } from "@/ux/components/patterns/states";
import { Card } from "@/ux/components/ui/card";
import { useListState, type ListFilterConfig } from "@/ux/hooks/use-list-state";
import { IMPORTER_NAMES, SOURCE_STATUS_META, type SourceStatus } from "@/ux/lib/domain";
import { errorMessage, isForbidden } from "@/ux/lib/api-state";

const SOURCES_FILTERS: { [K in ImporterSourcesFilterKey]: ListFilterConfig } = {
  status: {
    default: "all",
    values: ["all", ...(Object.keys(SOURCE_STATUS_META) as SourceStatus[])],
  },
  importerName: { default: "all", values: ["all", ...IMPORTER_NAMES] },
};

export function UxSourcesPage() {
  // Server-paginated list state lives in the URL (spec 068 / ADR-130).
  const list = useListState<ImporterSourcesSortKey, ImporterSourcesFilterKey>({
    sortKeys: IMPORTER_SOURCES_SORT_KEYS,
    filters: SOURCES_FILTERS,
  });
  const sources = useImporterSources(importerSourcesListParams(list));

  if (sources.isPending) {
    return (
      <PageContainer>
        <Card className="py-0">
          <TableSkeleton rows={4} columns={8} />
        </Card>
      </PageContainer>
    );
  }
  if (sources.error) {
    if (isForbidden(sources.error)) {
      return (
        <PageContainer>
          <ForbiddenState />
        </PageContainer>
      );
    }
    return (
      <PageContainer>
        <ErrorState description={errorMessage(sources.error)} onRetry={() => void sources.refetch()} />
      </PageContainer>
    );
  }
  return (
    <SourcesView
      sources={(sources.data?.data ?? []).map(mapImporterSource)}
      pagination={sources.data?.pagination}
      list={list}
    />
  );
}
