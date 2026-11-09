
import { InfoIcon, RadioTowerIcon } from "lucide-react"
import { EnrollAgentDialog } from "@/ux/components/agents/enroll-agent-dialog"
import { AgentsTable } from "@/ux/components/agents/agents-table"
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header"
import { EmptyState } from "@/ux/components/patterns/states"
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert"
import { Card } from "@/ux/components/ui/card"
import type { PaginationMeta } from "@/api/types"
import type { AgentsFilterKey, AgentsSortKey } from "@/api/hooks/agents"
import type { ListState } from "@/ux/hooks/use-list-state"
import type { ImportAgent } from "@/ux/lib/view-types"

export function AgentsView({
  agents: rows,
  pagination,
  list,
}: {
  agents: ImportAgent[]
  pagination?: PaginationMeta
  list: ListState<AgentsSortKey, AgentsFilterKey>
}) {
  const enroll = <EnrollAgentDialog existingNames={rows.map((a) => a.name)} />

  return (
    <PageContainer>
      <PageHeader
        title="Import agents"
        description="Run importers inside your own network and let them report to the hub. Use agents for sources the hub cannot reach directly."
        actions={enroll}
      />
      <Alert>
        <InfoIcon />
        <AlertTitle>Agents connect outbound</AlertTitle>
        <AlertDescription>
          Each agent opens a secure connection to the hub. No inbound firewall rules are needed, and secrets for private sources stay on the agent host.
        </AlertDescription>
      </Alert>
      {/* Fleet-wide status counts can't be computed from one page — the
          status filter + server totals carry that signal now (spec 068). */}
      {rows.length === 0 && !list.search && list.filters.status === "all" ? (
        <Card className="py-0">
          <EmptyState
            icon={RadioTowerIcon}
            title="No import agents yet"
            description="Enroll an agent to import from sources behind a firewall."
            action={enroll}
          />
        </Card>
      ) : (
        <AgentsTable rows={rows} list={list} pagination={pagination} />
      )}
    </PageContainer>
  )
}
