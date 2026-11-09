import { FileUpIcon, PlusIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { PRODUCTS_SORT_KEYS, productsListParams, useProducts, type ProductsFilterKey, type ProductsSortKey } from "@/api/hooks/products";
import { mapProduct } from "@/api/mappers/catalog";
import { ProductsTable } from "@/ux/components/products/products-table";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { Button } from "@/ux/components/ui/button";
import { ErrorState, TableSkeleton } from "@/ux/components/patterns/states";
import { Card } from "@/ux/components/ui/card";
import { useListState, type ListFilterConfig } from "@/ux/hooks/use-list-state";
import { CRITICALITY_META, PRODUCT_TYPE_META } from "@/ux/lib/domain";
import { ux } from "@/ux/lib/paths";
import { errorMessage } from "@/ux/lib/api-state";

const PRODUCTS_FILTERS: { [K in ProductsFilterKey]: ListFilterConfig } = {
  type: { default: "all", values: ["all", ...Object.keys(PRODUCT_TYPE_META)] },
  criticality: { default: "all", values: ["all", ...Object.keys(CRITICALITY_META)] },
  // Default ACTIVE: retired products stay hidden unless asked (unchanged
  // pre-068 behavior); "all" admits RETIRED rows.
  lifecycle: { default: "ACTIVE", values: ["all", "ACTIVE", "RETIRED"] },
  missing: { default: "all", values: ["all", "incomplete", "owner", "description", "dependencies"] },
};

export function UxProductsPage() {
  // Server-paginated list state lives in the URL (spec 068 / ADR-130).
  const list = useListState<ProductsSortKey, ProductsFilterKey>({
    sortKeys: PRODUCTS_SORT_KEYS,
    filters: PRODUCTS_FILTERS,
  });
  const { data, isPending, error, refetch } = useProducts(productsListParams(list));

  return (
    <PageContainer>
      <PageHeader
        title="Products"
        description="Business capabilities, shared platforms and customer-facing products — composed of the components your importers discover."
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={ux("/products/import")}>
                <FileUpIcon data-icon="inline-start" />
                Import
              </Link>
            </Button>
            <Button asChild>
              <Link to={ux("/products/new")}>
                <PlusIcon data-icon="inline-start" />
                New product
              </Link>
            </Button>
          </>
        }
      />
      {isPending ? (
        <Card className="py-0">
          <TableSkeleton rows={8} columns={7} />
        </Card>
      ) : error ? (
        <ErrorState
          title="Products unavailable"
          description={errorMessage(error)}
          onRetry={() => void refetch()}
        />
      ) : (
        <ProductsTable
          data={(data?.data ?? []).map((p) => mapProduct(p))}
          list={list}
          pagination={data?.pagination}
        />
      )}
    </PageContainer>
  );
}
