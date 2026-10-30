import type { Criticality } from "@/ux/lib/domain";
import { useParams } from "react-router-dom";
import { useAllComponents } from "@/api/hooks/components";
import { useEntityHistory } from "@/api/hooks/audit";
import { useProduct } from "@/api/hooks/products";
import { useSuggestions } from "@/api/hooks/suggestions";
import { mapDepComponent, mapProduct } from "@/api/mappers/catalog";
import { mapActivityItem } from "@/api/mappers/dashboard";
import { mapSuggestion } from "@/api/mappers/suggestions";
import { PageContainer } from "@/ux/components/patterns/page-header";
import { ErrorState, ForbiddenState, NotFoundState, TableSkeleton } from "@/ux/components/patterns/states";
import { ProductDetail } from "@/ux/components/products/product-detail";
import { Card } from "@/ux/components/ui/card";
import { Skeleton } from "@/ux/components/ui/skeleton";
import { errorMessage, isForbidden, isNotFound } from "@/ux/lib/api-state";
import { ux } from "@/ux/lib/paths";

export function UxProductDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const detail = useProduct(slug);
  const catalog = useAllComponents();
  const suggestions = useSuggestions("PENDING", 0, 100);
  const history = useEntityHistory("digital_product", detail.data?.product.id ?? "");

  if (detail.isPending) {
    return (
      <PageContainer>
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-6 w-full max-w-xl" />
        <Card className="py-0">
          <TableSkeleton rows={6} columns={4} />
        </Card>
      </PageContainer>
    );
  }

  if (detail.error) {
    if (isNotFound(detail.error)) {
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
    if (isForbidden(detail.error)) {
      return (
        <PageContainer>
          <ForbiddenState />
        </PageContainer>
      );
    }
    return (
      <PageContainer>
        <ErrorState description={errorMessage(detail.error)} onRetry={() => void detail.refetch()} />
      </PageContainer>
    );
  }

  const d = detail.data;
  const allInstances = [...d.instances.declared, ...d.instances.inherited];
  const rows = [...d.components.declared, ...d.components.inherited].map((ref) =>
    mapDepComponent(ref, catalog.data ?? [], allInstances),
  );

  return (
    <ProductDetail
      product={mapProduct(d.product, { componentCount: d.counts.components })}
      components={rows}
      consumers={d.consumedBy.map((p) => ({ id: p.id, name: p.name, slug: p.slug, criticality: (p as { criticality?: Criticality | null }).criticality ?? null }))}
      relations={[
        { label: "Composed by", names: (d.composedBy ?? []).map((x) => x.name) },
        { label: "Composes", names: (d.composes ?? []).map((x) => x.name) },
        { label: "Consumes from", names: (d.consumesFrom ?? []).map((x) => x.name) },
        { label: "Depends on groups", names: (d.dependsOnGroups ?? []).map((x) => (x as unknown as { name?: string }).name ?? "—") },
      ].filter((r) => r.names.length > 0)}
      suggestions={(suggestions.data?.items ?? [])
        .filter((s) => s.productId === d.product.id)
        .map(mapSuggestion)}
      activity={(history.data?.items ?? []).map(mapActivityItem)}
    />
  );
}
