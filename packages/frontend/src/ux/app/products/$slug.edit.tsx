import { useParams } from "react-router-dom";
import { useLobs, useTeams } from "@/api/hooks/org";
import { useProduct } from "@/api/hooks/products";
import { mapProduct } from "@/api/mappers/catalog";
import { ProductForm } from "@/ux/components/products/product-form";
import { PageContainer } from "@/ux/components/patterns/page-header";
import { ErrorState, ForbiddenState, NotFoundState, TableSkeleton } from "@/ux/components/patterns/states";
import { Card } from "@/ux/components/ui/card";
import { errorMessage, isForbidden, isNotFound } from "@/ux/lib/api-state";
import { ux } from "@/ux/lib/paths";

export function UxProductEditPage() {
  const { slug } = useParams<{ slug: string }>();
  const detail = useProduct(slug);
  const lobs = useLobs();
  const teams = useTeams();

  if (detail.isPending || lobs.isPending || teams.isPending) {
    return (
      <PageContainer width="narrow">
        <Card className="py-0">
          <TableSkeleton rows={4} columns={2} />
        </Card>
      </PageContainer>
    );
  }

  const err = detail.error ?? lobs.error ?? teams.error;
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
        <ErrorState description={errorMessage(err)} onRetry={() => void detail.refetch()} />
      </PageContainer>
    );
  }

  const d = detail.data;
  return (
    <ProductForm
      product={mapProduct(d.product, { componentCount: d.counts.components })}
      lobs={lobs.data?.lobs ?? []}
      teams={teams.data?.teams ?? []}
    />
  );
}
