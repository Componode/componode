import { useParams } from "react-router-dom";
import { useEntityHistory } from "@/api/hooks/audit";
import { useComponentDetail, useComponents } from "@/api/hooks/components";
import { mapActivityItem } from "@/api/mappers/dashboard";
import { EntityHistory } from "@/ux/components/patterns/entity-history";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { ErrorState, ForbiddenState, NotFoundState, TableSkeleton } from "@/ux/components/patterns/states";
import { Card } from "@/ux/components/ui/card";
import { errorMessage, isForbidden, isNotFound } from "@/ux/lib/api-state";
import { ux } from "@/ux/lib/paths";

export function UxComponentHistoryPage() {
  const { slug } = useParams<{ slug: string }>();
  const lookup = useComponents({ search: slug, includeRetired: true, pageSize: 100 });
  const componentId = lookup.data?.data.find((c) => c.slug === slug)?.id ?? null;
  const detail = useComponentDetail(componentId);
  const history = useEntityHistory("component", componentId ?? "");

  if (lookup.isPending || (componentId && (detail.isPending || history.isPending))) {
    return (
      <PageContainer width="narrow">
        <Card className="py-0">
          <TableSkeleton rows={5} columns={2} />
        </Card>
      </PageContainer>
    );
  }

  const err = lookup.error ?? detail.error ?? history.error;
  if (err || (lookup.isSuccess && !componentId)) {
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
            title="Component not found"
            description={`No component matches “${slug}”.`}
            backHref={ux("/components")}
            backLabel="All components"
          />
        </PageContainer>
      );
    }
    return (
      <PageContainer>
        <ErrorState description={errorMessage(err)} onRetry={() => void history.refetch()} />
      </PageContainer>
    );
  }

  if (!detail.data) return null;
  return (
    <PageContainer width="narrow">
      <PageHeader
        title={`${detail.data.component.name} history`}
        description="Every recorded change to this component, including importer runs that created or updated it."
      />
      <EntityHistory events={(history.data?.items ?? []).map(mapActivityItem)} entityLabel="component" />
    </PageContainer>
  );
}
