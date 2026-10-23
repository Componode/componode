import { useParams } from "react-router-dom";
import { useAgents } from "@/api/hooks/agents";
import { useCredentials } from "@/api/hooks/credentials";
import { useImporterConfig, useImporters } from "@/api/hooks/importers";
import { ImporterForm } from "@/ux/components/importers/importer-form";
import { PageContainer } from "@/ux/components/patterns/page-header";
import { ErrorState, ForbiddenState, NotFoundState, TableSkeleton } from "@/ux/components/patterns/states";
import { Card } from "@/ux/components/ui/card";
import { errorMessage, isForbidden, isNotFound } from "@/ux/lib/api-state";
import { ux } from "@/ux/lib/paths";

export function UxImporterEditPage() {
  const { id } = useParams<{ id: string }>();
  const config = useImporterConfig(id ?? null);
  const manifests = useImporters();
  const credentials = useCredentials();
  const agents = useAgents();

  if (config.isPending || manifests.isPending || credentials.isPending || agents.isPending) {
    return (
      <PageContainer width="narrow">
        <Card className="py-0">
          <TableSkeleton rows={4} columns={2} />
        </Card>
      </PageContainer>
    );
  }

  const err = config.error ?? manifests.error ?? credentials.error ?? agents.error;
  if (err || !config.data) {
    if (err && isForbidden(err)) {
      return (
        <PageContainer>
          <ForbiddenState />
        </PageContainer>
      );
    }
    if (!err || isNotFound(err)) {
      return (
        <PageContainer>
          <NotFoundState
            title="Importer not found"
            description="This importer configuration does not exist."
            backHref={ux("/importers")}
            backLabel="All importers"
          />
        </PageContainer>
      );
    }
    return (
      <PageContainer>
        <ErrorState description={errorMessage(err)} onRetry={() => void config.refetch()} />
      </PageContainer>
    );
  }

  return (
    <ImporterForm
      config={config.data.config}
      manifests={manifests.data?.importers ?? []}
      credentials={credentials.data?.credentials ?? []}
      agents={agents.data?.agents ?? []}
    />
  );
}
