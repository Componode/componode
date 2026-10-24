import { useLobs, useTeams } from "@/api/hooks/org";
import { ProductForm } from "@/ux/components/products/product-form";
import { PageContainer } from "@/ux/components/patterns/page-header";
import { ErrorState, TableSkeleton } from "@/ux/components/patterns/states";
import { Card } from "@/ux/components/ui/card";
import { errorMessage } from "@/ux/lib/api-state";

export function UxProductNewPage() {
  const lobs = useLobs();
  const teams = useTeams();

  if (lobs.isPending || teams.isPending) {
    return (
      <PageContainer width="narrow">
        <Card className="py-0">
          <TableSkeleton rows={4} columns={2} />
        </Card>
      </PageContainer>
    );
  }
  const err = lobs.error ?? teams.error;
  if (err) {
    return (
      <PageContainer width="narrow">
        <ErrorState
          description={errorMessage(err)}
          onRetry={() => {
            void lobs.refetch();
            void teams.refetch();
          }}
        />
      </PageContainer>
    );
  }
  return <ProductForm lobs={lobs.data?.lobs ?? []} teams={teams.data?.teams ?? []} />;
}
