import {
  AGENTS_SORT_KEYS,
  agentsListParams,
  useAgents,
  type AgentsFilterKey,
  type AgentsSortKey,
} from "@/api/hooks/agents";
import { mapImportAgent } from "@/api/mappers/operations";
import { AgentsView } from "@/ux/components/agents/agents-view";
import { PageContainer } from "@/ux/components/patterns/page-header";
import { ErrorState, ForbiddenState, TableSkeleton } from "@/ux/components/patterns/states";
import { Card } from "@/ux/components/ui/card";
import { useClampPage } from "@/ux/hooks/use-clamp-page";
import { useListState, type ListFilterConfig } from "@/ux/hooks/use-list-state";
import { AGENT_STATUS_META, type AgentStatus } from "@/ux/lib/domain";
import { errorMessage, isForbidden } from "@/ux/lib/api-state";

const AGENTS_FILTERS: { [K in AgentsFilterKey]: ListFilterConfig } = {
  status: {
    default: "all",
    values: ["all", ...(Object.keys(AGENT_STATUS_META) as AgentStatus[])],
  },
};

export function UxAgentsPage() {
  // Server-paginated list state lives in the URL (spec 068 / ADR-130).
  const list = useListState<AgentsSortKey, AgentsFilterKey>({
    sortKeys: AGENTS_SORT_KEYS,
    filters: AGENTS_FILTERS,
  });
  const agents = useAgents(agentsListParams(list));
  useClampPage(list, agents.data?.pagination);

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
  return (
    <AgentsView
      agents={(agents.data?.data ?? []).map(mapImportAgent)}
      pagination={agents.data?.pagination}
      list={list}
    />
  );
}
