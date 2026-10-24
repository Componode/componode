
import { InfoIcon, RadioTowerIcon } from "lucide-react"
import { EnrollAgentDialog } from "@/ux/components/agents/enroll-agent-dialog"
import { AgentsTable } from "@/ux/components/agents/agents-table"
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header"
import { EmptyState } from "@/ux/components/patterns/states"
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert"
import { Card, CardContent } from "@/ux/components/ui/card"
import type { ImportAgent } from "@/ux/lib/view-types"

function Summary({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <Card className="py-4">
      <CardContent className="flex flex-col gap-1 px-4">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="tabular text-2xl font-semibold">{value}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </CardContent>
    </Card>
  )
}

export function AgentsView({ agents: rows }: { agents: ImportAgent[] }) {
  const live = rows.filter((a) => a.credentialState === "ACTIVE")
  const connected = live.filter((a) => a.status === "CONNECTED").length
  const offline = live.filter((a) => a.status === "OFFLINE").length
  const pending = rows.filter((a) => a.credentialState === "PENDING_ENROLLMENT").length

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
      {rows.length === 0 ? (
        <Card className="py-0">
          <EmptyState
            icon={RadioTowerIcon}
            title="No import agents yet"
            description="Enroll an agent to import from sources behind a firewall."
            action={enroll}
          />
        </Card>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Summary label="Connected" value={connected} hint="Live session with the hub" />
            <Summary label="Offline" value={offline} hint="Jobs queue until reconnect" />
            <Summary label="Awaiting enrollment" value={pending} hint="Token issued, not yet used" />
          </div>
          <AgentsTable rows={rows} />
        </>
      )}
    </PageContainer>
  )
}
