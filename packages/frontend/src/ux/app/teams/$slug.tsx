import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { OrgDetail } from "@/ux/components/org/org-detail";
import { PageContainer } from "@/ux/components/patterns/page-header";
import { ErrorState, NotFoundState } from "@/ux/components/patterns/states";
import { Skeleton } from "@/ux/components/ui/skeleton";
import { useTeams, useUpdateTeam, useDeleteTeam, useTeamMembers } from "@/api/hooks/org";
import { useProducts } from "@/api/hooks/products";
import { useAllComponents } from "@/api/hooks/components";
import { useComponentGroups } from "@/api/hooks/component-groups";
import { mapComponent, mapProduct } from "@/api/mappers/catalog";
import { errorMessage } from "@/ux/lib/api-state";
import { ux } from "@/ux/lib/paths";

/** No detail GET — the team resolves through the list (wiring contract). */
export function UxTeamDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const teams = useTeams();
  const team = teams.data?.teams?.find((t) => t.slug === slug);
  const members = useTeamMembers(team?.id);
  const updateTeam = useUpdateTeam();
  const deleteTeam = useDeleteTeam();

  const products = useProducts({ includeRetired: true });
  const components = useAllComponents({ includeRetired: true });
  const groups = useComponentGroups();

  if (teams.isPending) {
    return (
      <PageContainer>
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </PageContainer>
    );
  }
  if (teams.error) {
    return (
      <PageContainer>
        <ErrorState description={errorMessage(teams.error)} onRetry={() => void teams.refetch()} />
      </PageContainer>
    );
  }
  if (!team) {
    return (
      <PageContainer>
        <NotFoundState backHref={ux("/teams")} backLabel="All teams" />
      </PageContainer>
    );
  }

  const ownedProducts = (products.data?.products ?? []).filter((p) => p.teamOwnerId === team.id).map((p) => mapProduct(p));
  const ownedComponents = (components.data ?? []).filter((c) => c.teamOwnerId === team.id).map(mapComponent);
  const ownedGroups = (groups.data?.groups ?? []).filter((g) => g.teamOwnerId === team.id);

  return (
    <OrgDetail
      noun="team"
      icon="team"
      entity={team}
      stats={[
        { label: "Members", value: members.data ? members.data.members.length : "—" },
        { label: "Products", value: ownedProducts.length },
        { label: "Components", value: ownedComponents.length },
        { label: "Component groups", value: ownedGroups.length },
      ]}
      ownedProducts={ownedProducts}
      ownedComponents={ownedComponents}
      ownedTotal={ownedProducts.length + ownedComponents.length}
      editPending={updateTeam.isPending}
      onEdit={({ name, slug: s, description }) =>
        updateTeam.mutate(
          { id: team.id, name, slug: s, description },
          {
            onSuccess: () => toast.success("Team updated"),
            onError: (e) => toast.error(e.message),
          },
        )
      }
      onDelete={() =>
        deleteTeam.mutate(team.id, {
          onSuccess: () => navigate(ux("/teams")),
          onError: (e) => toast.error(e.message),
        })
      }
    />
  );
}
