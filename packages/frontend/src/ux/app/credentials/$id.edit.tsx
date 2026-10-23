import { useParams } from "react-router-dom";
import { CredentialForm } from "@/ux/components/admin/credential-form";
import { PageContainer } from "@/ux/components/patterns/page-header";
import { ErrorState, NotFoundState } from "@/ux/components/patterns/states";
import { Skeleton } from "@/ux/components/ui/skeleton";
import { useCredential } from "@/api/hooks/credentials";
import { errorMessage, isNotFound } from "@/ux/lib/api-state";
import { ux } from "@/ux/lib/paths";

/** Rotate — PATCH secrets/secretRefMap on the existing credential. */
export function UxCredentialEditPage() {
  const { id } = useParams<{ id: string }>();
  const detail = useCredential(id ?? null);

  if (detail.isPending) {
    return (
      <PageContainer width="narrow">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-48 w-full" />
      </PageContainer>
    );
  }
  if (detail.error || !detail.data) {
    return (
      <PageContainer width="narrow">
        {detail.error && isNotFound(detail.error) ? (
          <NotFoundState backHref={ux("/credentials")} backLabel="All credentials" />
        ) : (
          <ErrorState description={errorMessage(detail.error)} onRetry={() => void detail.refetch()} />
        )}
      </PageContainer>
    );
  }

  const c = detail.data.credential;
  return <CredentialForm mode="rotate" credential={{ id: c.id, label: c.label, kind: c.kind }} />;
}
