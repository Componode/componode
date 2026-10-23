import { FileUpIcon, PlusIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { useProducts } from "@/api/hooks/products";
import { mapProduct } from "@/api/mappers/catalog";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { ErrorState, TableSkeleton } from "@/ux/components/patterns/states";
import { ProductsTable } from "@/ux/components/products/products-table";
import { Button } from "@/ux/components/ui/button";
import { Card } from "@/ux/components/ui/card";
import { ux } from "@/ux/lib/paths";

export function UxProductsPage() {
  // includeRetired: the table owns the lifecycle facet and must be able to
  // show retired rows; its default filter hides them.
  const { data, isPending, error, refetch } = useProducts({ includeRetired: true });

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
          <TableSkeleton rows={8} columns={5} />
        </Card>
      ) : error ? (
        <ErrorState
          title="Products unavailable"
          description={error.message}
          onRetry={() => void refetch()}
        />
      ) : (
        <ProductsTable data={data.products.map((p) => mapProduct(p))} />
      )}
    </PageContainer>
  );
}
