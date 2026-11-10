import { useParams } from "react-router-dom";
import { useAllComponents } from "@/api/hooks/components";
import { useProduct } from "@/api/hooks/products";
import { usePagedEntityHistory } from "@/ux/hooks/use-entity-history";
import { useSuggestions } from "@/api/hooks/suggestions";
import { isDirectDep, mapDepComponent, mapProduct, mapProductTopology, mapRelatedProduct } from "@/api/mappers/catalog";
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
  const suggestions = useSuggestions("PENDING", { page: 1, pageSize: 100 });
  const history = usePagedEntityHistory("digital_product", detail.data?.product.id ?? "");

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

  // G31 edge authoring: only components reached through a DIRECT edge are
  // removable — group-expanded members are removed via their group edge.
  const directDepComponents = d.components.declared
    .filter(isDirectDep)
    .map((c) => ({ id: c.id, name: c.name, slug: c.slug }));

  return (
    <ProductDetail
      product={mapProduct(d.product, {
        componentCount: d.counts.components,
        consumedByCount: (d.consumedBy ?? []).length,
        status: d.health?.status ?? null,
      })}
      components={rows}
      consumers={d.consumedBy.map((p) => {
        const m = mapRelatedProduct(p);
        return { id: m.id, name: m.name, slug: m.slug, criticality: m.criticality };
      })}
      parents={(d.composedBy ?? []).map((p) => {
        const m = mapRelatedProduct(p);
        return { id: m.id, name: m.name, slug: m.slug, criticality: m.criticality };
      })}
      edges={{
        composes: d.composes ?? [],
        consumesFrom: d.consumesFrom ?? [],
        dependsOnComponents: directDepComponents,
        dependsOnGroups: d.dependsOnGroups ?? [],
      }}
      topology={mapProductTopology(d, { instances: allInstances })}
      suggestions={(suggestions.data?.items ?? [])
        .filter((s) => s.productId === d.product.id)
        .map(mapSuggestion)}
      activity={(history.data?.items ?? []).map(mapActivityItem)}
      activityPagination={history.pagination}
    />
  );
}
