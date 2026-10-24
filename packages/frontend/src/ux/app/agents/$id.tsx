import { useParams } from "react-router-dom";
import { useAgent, useAgentSessions } from "@/api/hooks/agents";
import { useEntityHistory } from "@/api/hooks/audit";
import { mapActivityItem } from "@/api/mappers/dashboard";
import { mapAgentSession, mapImportAgent } from "@/api/mappers/operations";
import { AgentDetail } from "@/ux/components/agents/agent-detail";
import { PageContainer } from "@/ux/components/patterns/page-header";
import { ErrorState, ForbiddenState, NotFoundState, TableSkeleton } from "@/ux/components/patterns/states";
import { Card } from "@/ux/components/ui/card";
import { errorMessage, isForbidden, isNotFound } from "@/ux/lib/api-state";
import { ux } from "@/ux/lib/paths";

export function UxAgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const agent = useAgent(id ?? null);
  const sessions = useAgentSessions(id ?? null);
  const history = useEntityHistory("import_agent", id ?? "");

  if (agent.isPending || (agent.isSuccess && (sessions.isPending || history.isPending))) {
    return (
      <PageContainer>
        <Card className="py-0">
          <TableSkeleton rows={6} columns={4} />
        </Card>
      </PageContainer>
    );
  }

  const err = agent.error ?? sessions.error ?? history.error;
  if (err || !agent.data) {
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
            title="Agent not found"
            description="This import agent does not exist."
            backHref={ux("/agents")}
            backLabel="All agents"
          />
        </PageContainer>
      );
    }
    return (
      <PageContainer>
        <ErrorState description={errorMessage(err)} onRetry={() => void agent.refetch()} />
      </PageContainer>
    );
  }

  return (
    <AgentDetail
      agent={mapImportAgent(agent.data.agent)}
      sessions={(sessions.data?.sessions ?? []).map(mapAgentSession)}
      events={(history.data?.items ?? []).map(mapActivityItem)}
    />
  );
}
