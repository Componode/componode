import { useParams } from "react-router-dom";
import { useEntityHistory } from "@/api/hooks/audit";
import { useProduct } from "@/api/hooks/products";
import { mapActivityItem } from "@/api/mappers/dashboard";
import { EntityHistory } from "@/ux/components/patterns/entity-history";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { ErrorState, ForbiddenState, NotFoundState, TableSkeleton } from "@/ux/components/patterns/states";
import { Card } from "@/ux/components/ui/card";
import { errorMessage, isForbidden, isNotFound } from "@/ux/lib/api-state";
import { ux } from "@/ux/lib/paths";

export function UxProductHistoryPage() {
  const { slug } = useParams<{ slug: string }>();
  const detail = useProduct(slug);
  const history = useEntityHistory("digital_product", detail.data?.product.id ?? "");

  if (detail.isPending || (detail.isSuccess && history.isPending)) {
    return (
      <PageContainer width="narrow">
        <Card className="py-0">
          <TableSkeleton rows={5} columns={2} />
        </Card>
      </PageContainer>
    );
  }

  const err = detail.error ?? history.error;
  if (err || !detail.data) {
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
            title="Product not found"
            description={`No product matches “${slug}”.`}
            backHref={ux("/products")}
            backLabel="All products"
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

  return (
    <PageContainer width="narrow">
      <PageHeader
        title={`${detail.data.product.name} history`}
        description="Every recorded change to this product, including importer-driven updates."
      />
      <EntityHistory events={(history.data?.items ?? []).map(mapActivityItem)} entityLabel="product" />
    </PageContainer>
  );
}
