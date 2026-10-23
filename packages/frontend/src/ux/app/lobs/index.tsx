import { toast } from "sonner";
import { OrgFormDialog } from "@/ux/components/org/org-form-dialog";
import { LobsGrid, type OrgCounts } from "@/ux/components/org/org-tables";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { ErrorState, TableSkeleton } from "@/ux/components/patterns/states";
import { Card } from "@/ux/components/ui/card";
import { useLobs, useCreateLob } from "@/api/hooks/org";
import { useProducts } from "@/api/hooks/products";
import { errorMessage } from "@/ux/lib/api-state";

export function UxLobsPage() {
  const lobs = useLobs();
  const createLob = useCreateLob();
  const products = useProducts({ includeRetired: true });

  const counts = new Map<string, OrgCounts>();
  for (const l of lobs.data?.lobs ?? []) {
    counts.set(l.id, {
      products: (products.data?.products ?? []).filter((p) => p.lobOwnerId === l.id).length,
    });
  }

  return (
    <PageContainer>
      <PageHeader
        title="Lines of business"
        description="The top of the ownership tree. Every product rolls up to exactly one line of business."
        actions={
          <OrgFormDialog
            noun="line of business"
            pending={createLob.isPending}
            onSubmit={({ name, slug, description }) =>
              createLob.mutate(
                { name, slug, description },
                {
                  onSuccess: () => toast.success(`Line of business ${name} created`),
                  onError: (e) => toast.error(e.message),
                },
              )
            }
          />
        }
      />
      {lobs.isPending ? (
        <Card className="py-0">
          <TableSkeleton rows={5} columns={4} />
        </Card>
      ) : lobs.error ? (
        <ErrorState description={errorMessage(lobs.error)} onRetry={() => void lobs.refetch()} />
      ) : (
        <LobsGrid data={(lobs.data.lobs ?? [])} counts={counts} />
      )}
    </PageContainer>
  );
}
