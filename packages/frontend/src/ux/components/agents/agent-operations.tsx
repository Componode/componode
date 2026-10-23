import { ActivityIcon, ClockIcon } from "lucide-react"
import { RelativeTime } from "@/ux/components/patterns/primitives"
import { StatusBadge } from "@/ux/components/patterns/status-badge"
import { EmptyState } from "@/ux/components/patterns/states"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ux/components/ui/card"
import { formatNumber } from "@/ux/lib/format"
import type { ImportAgent } from "@/ux/lib/mock-data"

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function Metric({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "warning" }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-3">
      <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className={`tabular text-xl font-semibold ${tone === "warning" ? "text-warning" : ""}`}>{value}</span>
      {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
    </div>
  )
}

export function AgentOperations({ agent }: { agent: ImportAgent }) {
  const r = agent.reportedStatus
  const live = agent.status === "CONNECTED"

  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle>Operations</CardTitle>
        <CardDescription>
          Counters reported by the agent in its heartbeat since it last started. They reset on restart and contain counts only, never key names or secret values.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!r ? (
          <EmptyState
            icon={ActivityIcon}
            title="This agent has not reported operations data"
            description={
              agent.agentVersion
                ? `Version ${agent.agentVersion} predates operations reporting. Upgrade the agent to see job and credential counters.`
                : "Counters appear after the agent connects and sends its first heartbeat."
            }
          />
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <ClockIcon className="size-4" aria-hidden="true" />
              <span>
                Reported <RelativeTime iso={r.receivedAt} />
              </span>
              {!live && <StatusBadge tone="warning" label="Last known" description="The agent is not connected, so these values may be stale" />}
            </div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Metric label="Uptime" value={formatUptime(r.uptimeSeconds)} hint={`${r.reconnects} reconnect${r.reconnects === 1 ? "" : "s"}`} />
              <Metric label="Active jobs" value={String(r.activeJobs)} hint={agent.maxConcurrentJobs ? `of ${agent.maxConcurrentJobs} slots` : undefined} />
              <Metric label="Assets streamed" value={formatNumber(r.assetsStreamed)} />
              <Metric
                label="Secret failures"
                value={String(r.secretResolutionFailures)}
                hint="Credentials the agent could not resolve"
                tone={r.secretResolutionFailures > 0 ? "warning" : undefined}
              />
              <Metric label="Jobs assigned" value={formatNumber(r.jobs.assigned)} />
              <Metric label="Completed" value={formatNumber(r.jobs.completed)} />
              <Metric label="Failed" value={formatNumber(r.jobs.failed)} hint={`${r.jobs.cancelled} cancelled`} tone={r.jobs.failed > 0 ? "warning" : undefined} />
              <Metric
                label="Credential tests"
                value={`${r.credentialTests.succeeded}/${r.credentialTests.dispatched}`}
                hint={r.credentialTests.failed > 0 ? `${r.credentialTests.failed} failed` : "All passed"}
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
