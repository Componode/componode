import { useParams } from "react-router-dom";
import { CredentialDetail } from "@/ux/components/admin/credential-detail";
import { PageContainer } from "@/ux/components/patterns/page-header";
import { ErrorState, NotFoundState } from "@/ux/components/patterns/states";
import { Skeleton } from "@/ux/components/ui/skeleton";
import { useCredential } from "@/api/hooks/credentials";
import { useEntityHistory } from "@/api/hooks/audit";
import { useImporterConfigs } from "@/api/hooks/importers";
import { mapActivityItem } from "@/api/mappers/dashboard";
import { mapCredential } from "@/api/mappers/operations";
import { errorMessage, isNotFound } from "@/ux/lib/api-state";
import { ux } from "@/ux/lib/paths";

export function UxCredentialDetailPage() {
  const { id } = useParams<{ id: string }>();
  const detail = useCredential(id ?? null);
  const configs = useImporterConfigs();
  const history = useEntityHistory("credential", id ?? "");

  if (detail.isPending) {
    return (
      <PageContainer>
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </PageContainer>
    );
  }
  if (detail.error) {
    return (
      <PageContainer>
        {isNotFound(detail.error) ? (
          <NotFoundState backHref={ux("/credentials")} backLabel="All credentials" />
        ) : (
          <ErrorState description={errorMessage(detail.error)} onRetry={() => void detail.refetch()} />
        )}
      </PageContainer>
    );
  }
  if (!detail.data) {
    return (
      <PageContainer>
        <NotFoundState backHref={ux("/credentials")} backLabel="All credentials" />
      </PageContainer>
    );
  }

  const { credential, dependents } = detail.data;
  // Usage list comes from the detail endpoint's dependents; the full config
  // rows supply importerName + scope for "Test connection".
  const boundIds = new Set(dependents.importerConfigs.map((d) => d.id));
  const importers = (configs.data?.configs ?? []).filter((c) => boundIds.has(c.id));

  return (
    <CredentialDetail
      credential={mapCredential(credential, importers.length)}
      importers={importers}
      events={(history.data?.items ?? []).map(mapActivityItem)}
    />
  );
}
