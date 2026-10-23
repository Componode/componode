import { useParams } from "react-router-dom";
import { useComponentDependents, useComponentDetail, useComponents } from "@/api/hooks/components";
import { mapComponent } from "@/api/mappers/catalog";
import { PromoteForm } from "@/ux/components/components/promote-form";
import { PageContainer } from "@/ux/components/patterns/page-header";
import { ErrorState, ForbiddenState, NotFoundState, TableSkeleton } from "@/ux/components/patterns/states";
import { Card } from "@/ux/components/ui/card";
import { errorMessage, isForbidden, isNotFound } from "@/ux/lib/api-state";
import { ux } from "@/ux/lib/paths";

export function UxComponentPromotePage() {
  const { slug } = useParams<{ slug: string }>();
  // Route params are slugs; the API addresses components by id — resolve via the list.
  const lookup = useComponents({ search: slug, includeRetired: true, pageSize: 100 });
  const componentId = lookup.data?.data.find((c) => c.slug === slug)?.id ?? null;
  const detail = useComponentDetail(componentId);
  const dependents = useComponentDependents(componentId);

  if (lookup.isPending || (componentId && (detail.isPending || dependents.isPending))) {
    return (
      <PageContainer width="narrow">
        <Card className="py-0">
          <TableSkeleton rows={5} columns={2} />
        </Card>
      </PageContainer>
    );
  }

  const err = lookup.error ?? detail.error ?? dependents.error;
  if (err || (lookup.isSuccess && !componentId) || !detail.data) {
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
        <ErrorState
          description={errorMessage(err)}
          onRetry={() => {
            void lookup.refetch();
            void detail.refetch();
          }}
        />
      </PageContainer>
    );
  }

  return <PromoteForm component={mapComponent(detail.data.component)} consumers={dependents.data ?? []} />;
}
