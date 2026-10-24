import { useParams } from "react-router-dom";
import { useComponentDetail, useComponents } from "@/api/hooks/components";
import { mapComponent } from "@/api/mappers/catalog";
import { ComponentDetail } from "@/ux/components/catalog/component-detail";
import { PageContainer } from "@/ux/components/patterns/page-header";
import { ErrorState, ForbiddenState, NotFoundState, TableSkeleton } from "@/ux/components/patterns/states";
import { Card } from "@/ux/components/ui/card";
import { Skeleton } from "@/ux/components/ui/skeleton";
import { errorMessage, isForbidden, isNotFound } from "@/ux/lib/api-state";
import { ux } from "@/ux/lib/paths";

export function UxComponentDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  // Route params are slugs (prototype convention); the API addresses
  // components by id — resolve slug→id through the list endpoint.
  const lookup = useComponents({ search: slug, includeRetired: true, pageSize: 100 });
  const componentId = lookup.data?.data.find((c) => c.slug === slug)?.id ?? null;
  const detail = useComponentDetail(componentId);

  if (lookup.isPending || (componentId && detail.isPending)) {
    return (
      <PageContainer>
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-6 w-full max-w-xl" />
        <Card className="py-0">
          <TableSkeleton rows={5} columns={5} />
        </Card>
      </PageContainer>
    );
  }

  const err = lookup.error ?? detail.error;
  if (err || (lookup.isSuccess && !componentId)) {
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
    if (isForbidden(err)) {
      return (
        <PageContainer>
          <ForbiddenState />
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

  if (!detail.data) return null;
  return <ComponentDetail component={mapComponent(detail.data.component)} />;
}
