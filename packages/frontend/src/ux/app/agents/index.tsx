import { useAgents } from "@/api/hooks/agents";
import { mapImportAgent } from "@/api/mappers/operations";
import { AgentsView } from "@/ux/components/agents/agents-view";
import { PageContainer } from "@/ux/components/patterns/page-header";
import { ErrorState, ForbiddenState, TableSkeleton } from "@/ux/components/patterns/states";
import { Card } from "@/ux/components/ui/card";
import { errorMessage, isForbidden } from "@/ux/lib/api-state";

export function UxAgentsPage() {
  const agents = useAgents();

  if (agents.isPending) {
    return (
      <PageContainer>
        <Card className="py-0">
          <TableSkeleton rows={4} columns={4} />
        </Card>
      </PageContainer>
    );
  }
  if (agents.error) {
    if (isForbidden(agents.error)) {
      return (
        <PageContainer>
          <ForbiddenState />
        </PageContainer>
      );
    }
    return (
      <PageContainer>
        <ErrorState description={errorMessage(agents.error)} onRetry={() => void agents.refetch()} />
      </PageContainer>
    );
  }
  return <AgentsView agents={(agents.data?.agents ?? []).map(mapImportAgent)} />;
}
