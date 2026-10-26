import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { OrgDetail } from "@/ux/components/org/org-detail";
import { PageContainer } from "@/ux/components/patterns/page-header";
import { ErrorState, NotFoundState } from "@/ux/components/patterns/states";
import { Skeleton } from "@/ux/components/ui/skeleton";
import { useTeam, useUpdateTeam, useDeleteTeam, useTeamMembers, useLobs } from "@/api/hooks/org";
import { useProducts } from "@/api/hooks/products";
import { useAllComponents } from "@/api/hooks/components";
import { useComponentGroups } from "@/api/hooks/component-groups";
import { mapComponent, mapProduct } from "@/api/mappers/catalog";
import { errorMessage, isNotFound } from "@/ux/lib/api-state";
import { ux } from "@/ux/lib/paths";

/** Direct detail read — `GET /teams/:id` accepts the route slug (spec 033). */
export function UxTeamDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const teamQ = useTeam(slug);
  const team = teamQ.data?.team;
  const members = useTeamMembers(team?.id);
  const updateTeam = useUpdateTeam();
  const deleteTeam = useDeleteTeam();
  const lobs = useLobs();

  const products = useProducts({ includeRetired: true });
  const components = useAllComponents({ includeRetired: true });
  const groups = useComponentGroups();

  if (teamQ.isPending) {
    return (
      <PageContainer>
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </PageContainer>
    );
  }
  if (teamQ.error) {
    return (
      <PageContainer>
        {isNotFound(teamQ.error) ? (
          <NotFoundState backHref={ux("/teams")} backLabel="All teams" />
        ) : (
          <ErrorState description={errorMessage(teamQ.error)} onRetry={() => void teamQ.refetch()} />
        )}
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
        {
          label: "Line of business",
          value: team.lob ? (
            <Link to={ux(`/lobs/${team.lob.slug}`)} className="hover:underline">
              {team.lob.name}
            </Link>
          ) : (
            "Unassociated"
          ),
        },
        { label: "Members", value: members.data ? members.data.members.length : "—" },
        { label: "Products", value: ownedProducts.length },
        { label: "Components", value: ownedComponents.length },
        { label: "Component groups", value: ownedGroups.length },
      ]}
      lobs={lobs.data?.lobs ?? []}
      ownedProducts={ownedProducts}
      ownedComponents={ownedComponents}
      ownedTotal={ownedProducts.length + ownedComponents.length}
      editPending={updateTeam.isPending}
      onEdit={({ name, slug: s, description, lobId }) =>
        updateTeam.mutate(
          { id: team.id, name, slug: s, description, lobId },
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
