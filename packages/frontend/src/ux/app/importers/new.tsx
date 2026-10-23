import { useAgents } from "@/api/hooks/agents";
import { useCredentials } from "@/api/hooks/credentials";
import { useImporters } from "@/api/hooks/importers";
import { ImporterForm } from "@/ux/components/importers/importer-form";
import { PageContainer } from "@/ux/components/patterns/page-header";
import { ErrorState, TableSkeleton } from "@/ux/components/patterns/states";
import { Card } from "@/ux/components/ui/card";
import { errorMessage } from "@/ux/lib/api-state";

export function UxImporterNewPage() {
  const manifests = useImporters();
  const credentials = useCredentials();
  const agents = useAgents();

  if (manifests.isPending || credentials.isPending || agents.isPending) {
    return (
      <PageContainer width="narrow">
        <Card className="py-0">
          <TableSkeleton rows={4} columns={2} />
        </Card>
      </PageContainer>
    );
  }
  const err = manifests.error ?? credentials.error ?? agents.error;
  if (err) {
    return (
      <PageContainer>
        <ErrorState description={errorMessage(err)} onRetry={() => void manifests.refetch()} />
      </PageContainer>
    );
  }
  return (
    <ImporterForm
      manifests={manifests.data?.importers ?? []}
      credentials={credentials.data?.credentials ?? []}
      agents={agents.data?.agents ?? []}
    />
  );
}
