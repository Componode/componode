import { useImporterSources } from "@/api/hooks/importer-sources";
import { mapImporterSource } from "@/api/mappers/operations";
import { SourcesView } from "@/ux/components/sources/sources-view";
import { PageContainer } from "@/ux/components/patterns/page-header";
import { ErrorState, ForbiddenState, TableSkeleton } from "@/ux/components/patterns/states";
import { Card } from "@/ux/components/ui/card";
import { errorMessage, isForbidden } from "@/ux/lib/api-state";

export function UxSourcesPage() {
  const sources = useImporterSources();

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
  return <SourcesView sources={(sources.data?.sources ?? []).map(mapImporterSource)} />;
}
