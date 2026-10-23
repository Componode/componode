import { toast } from "sonner";
import { OrgFormDialog } from "@/ux/components/org/org-form-dialog";
import { TeamsTable, type OrgCounts } from "@/ux/components/org/org-tables";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { ErrorState, TableSkeleton } from "@/ux/components/patterns/states";
import { Card } from "@/ux/components/ui/card";
import { useTeams, useCreateTeam } from "@/api/hooks/org";
import { useProducts } from "@/api/hooks/products";
import { useAllComponents } from "@/api/hooks/components";
import { errorMessage } from "@/ux/lib/api-state";

export function UxTeamsPage() {
  const teams = useTeams();
  const createTeam = useCreateTeam();
  const products = useProducts({ includeRetired: true });
  const components = useAllComponents({ includeRetired: true });

  const counts = new Map<string, OrgCounts>();
  for (const t of teams.data?.teams ?? []) {
    counts.set(t.id, {
      products: (products.data?.products ?? []).filter((p) => p.teamOwnerId === t.id).length,
      components: (components.data ?? []).filter((c) => c.teamOwnerId === t.id).length,
    });
  }

  return (
    <PageContainer>
      <PageHeader
        title="Teams"
        description="The people accountable for products and components. Ownership drives notifications and incident routing."
        actions={
          <OrgFormDialog
            noun="team"
            pending={createTeam.isPending}
            onSubmit={({ name, slug, description }) =>
              createTeam.mutate(
                { name, slug, description },
                {
                  onSuccess: () => toast.success(`Team ${name} created`),
                  onError: (e) => toast.error(e.message),
                },
              )
            }
          />
        }
      />
      {teams.isPending ? (
        <Card className="py-0">
          <TableSkeleton rows={5} columns={4} />
        </Card>
      ) : teams.error ? (
        <ErrorState description={errorMessage(teams.error)} onRetry={() => void teams.refetch()} />
      ) : (
        <TeamsTable data={(teams.data.teams ?? [])} counts={counts} />
      )}
    </PageContainer>
  );
}
