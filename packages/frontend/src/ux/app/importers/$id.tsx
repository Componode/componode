import { useParams } from "react-router-dom";
import { useCredentials } from "@/api/hooks/credentials";
import { useImporterConfig, useImporterRuns } from "@/api/hooks/importers";
import { mapImporterConfig, mapImportRun } from "@/api/mappers/operations";
import { ImporterDetail } from "@/ux/components/importers/importer-detail";
import { PageContainer } from "@/ux/components/patterns/page-header";
import { ErrorState, ForbiddenState, NotFoundState, TableSkeleton } from "@/ux/components/patterns/states";
import { Card } from "@/ux/components/ui/card";
import { errorMessage, isForbidden, isNotFound } from "@/ux/lib/api-state";
import { ux } from "@/ux/lib/paths";

export function UxImporterDetailPage() {
  const { id } = useParams<{ id: string }>();
  const config = useImporterConfig(id ?? null);
  const runs = useImporterRuns(id ?? null);
  const credentials = useCredentials();

  if (config.isPending || runs.isPending) {
    return (
      <PageContainer>
        <Card className="py-0">
          <TableSkeleton rows={6} columns={4} />
        </Card>
      </PageContainer>
    );
  }

  const err = config.error ?? runs.error ?? credentials.error;
  if (err || !config.data) {
    if (err && isForbidden(err)) {
      return (
        <PageContainer>
          <ForbiddenState />
        </PageContainer>
      );
    }
    if (!err || isNotFound(err)) {
      return (
        <PageContainer>
          <NotFoundState
            title="Importer not found"
            description="This importer configuration does not exist."
            backHref={ux("/importers")}
            backLabel="All importers"
          />
        </PageContainer>
      );
    }
    return (
      <PageContainer>
        <ErrorState description={errorMessage(err)} onRetry={() => void config.refetch()} />
      </PageContainer>
    );
  }

  return (
    <ImporterDetail
      importer={mapImporterConfig(config.data.config, credentials.data?.credentials ?? [])}
      runs={(runs.data?.runs ?? []).map(mapImportRun)}
    />
  );
}
