import { useParams } from "react-router-dom";
import { useEntityHistory } from "@/api/hooks/audit";
import { useImporterSource, useSourceMemberships, useSourceRuns } from "@/api/hooks/importer-sources";
import { mapActivityItem } from "@/api/mappers/dashboard";
import { mapImporterSource } from "@/api/mappers/operations";
import { SourceDetail } from "@/ux/components/sources/source-detail";
import { PageContainer } from "@/ux/components/patterns/page-header";
import { ErrorState, ForbiddenState, NotFoundState, TableSkeleton } from "@/ux/components/patterns/states";
import { Card } from "@/ux/components/ui/card";
import { errorMessage, isForbidden, isNotFound } from "@/ux/lib/api-state";
import { ux } from "@/ux/lib/paths";

export function UxSourceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const source = useImporterSource(id ?? null);
  const runs = useSourceRuns(id ?? null);
  const memberships = useSourceMemberships(id ?? null);
  const history = useEntityHistory("importer_source", id ?? "");

  if (source.isPending || (source.isSuccess && (runs.isPending || memberships.isPending || history.isPending))) {
    return (
      <PageContainer>
        <Card className="py-0">
          <TableSkeleton rows={6} columns={4} />
        </Card>
      </PageContainer>
    );
  }

  const err = source.error ?? runs.error ?? memberships.error ?? history.error;
  if (err || !source.data) {
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
            title="Source not found"
            description="This importer source does not exist."
            backHref={ux("/sources")}
            backLabel="All sources"
          />
        </PageContainer>
      );
    }
    return (
      <PageContainer>
        <ErrorState description={errorMessage(err)} onRetry={() => void source.refetch()} />
      </PageContainer>
    );
  }

  return (
    <SourceDetail
      source={mapImporterSource(source.data.source)}
      runs={runs.data?.runs ?? []}
      memberships={memberships.data}
      events={(history.data?.items ?? []).map(mapActivityItem)}
    />
  );
}
