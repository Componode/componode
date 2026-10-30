import { useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
import { OrgDetail } from "@/ux/components/org/org-detail";
import { PageContainer } from "@/ux/components/patterns/page-header";
import { ErrorState, ForbiddenState, NotFoundState } from "@/ux/components/patterns/states";
import { Skeleton } from "@/ux/components/ui/skeleton";
import { useLob, useUpdateLob, useDeleteLob, useTeams } from "@/api/hooks/org";
import { useProducts } from "@/api/hooks/products";
import { mapProduct } from "@/api/mappers/catalog";
import { errorMessage, isForbidden, isNotFound } from "@/ux/lib/api-state";
import { ux } from "@/ux/lib/paths";

/** Direct detail read — `GET /lobs/:id` accepts the route slug (spec 033). */
export function UxLobDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const lobQ = useLob(slug);
  const lob = lobQ.data?.lob;
  const updateLob = useUpdateLob();
  const deleteLob = useDeleteLob();
  const products = useProducts({ includeRetired: true });
  const teams = useTeams();

  if (lobQ.isPending) {
    return (
      <PageContainer>
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </PageContainer>
    );
  }
  if (lobQ.error) {
    return (
      <PageContainer>
        {isNotFound(lobQ.error) ? (
          <NotFoundState backHref={ux("/lobs")} backLabel="All lines of business" />
        ) : isForbidden(lobQ.error) ? (
          <ForbiddenState />
        ) : (
          <ErrorState description={errorMessage(lobQ.error)} onRetry={() => void lobQ.refetch()} />
        )}
      </PageContainer>
    );
  }
  if (!lob) {
    return (
      <PageContainer>
        <NotFoundState backHref={ux("/lobs")} backLabel="All lines of business" />
      </PageContainer>
    );
  }

  const ownedProducts = (products.data?.products ?? []).filter((p) => p.lobOwnerId === lob.id).map((p) => mapProduct(p));
  const associatedTeams = teams.isPending
    ? undefined
    : (teams.data?.teams ?? []).filter((t) => t.lobId === lob.id);

  return (
    <OrgDetail
      noun="line of business"
      icon="lob"
      entity={lob}
      stats={[
        { label: "Products", value: ownedProducts.length },
        { label: "Teams", value: associatedTeams ? associatedTeams.length : "—" },
        { label: "Slug", value: <code className="font-mono text-xs">{lob.slug}</code> },
      ]}
      associatedTeams={associatedTeams}
      ownedProducts={ownedProducts}
      ownedComponents={[]}
      ownedTotal={ownedProducts.length + (associatedTeams?.length ?? 0)}
      blockedReason={`Move its ${associatedTeams?.length ?? 0} team${(associatedTeams?.length ?? 0) === 1 ? "" : "s"} and ${ownedProducts.length} product${ownedProducts.length === 1 ? "" : "s"} elsewhere before deleting.`}
      editPending={updateLob.isPending}
      onEdit={({ name, slug: s, description }) =>
        updateLob.mutate(
          { id: lob.id, name, slug: s, description },
          {
            onSuccess: () => toast.success("Line of business updated"),
            onError: (e) => toast.error(e.message),
          },
        )
      }
      onDelete={() =>
        deleteLob.mutate(lob.id, {
          onSuccess: () => navigate(ux("/lobs")),
          onError: (e) => toast.error(e.message),
        })
      }
    />
  );
}
