
import { flags } from "@/ux/lib/flags";
import { AlertTriangleIcon, HistoryIcon, RadioTowerIcon } from "lucide-react"
import { Link } from "react-router-dom"
import { useNavigate } from "react-router-dom"
import { useValidatedTab } from "@/ux/lib/use-validated-tab"
import * as React from "react"
import { toast } from "sonner"
import { AgentOperations } from "@/ux/components/agents/agent-operations"
import { AgentStatusCell } from "@/ux/components/agents/agents-table"
import { EnrollmentTokenPanel } from "@/ux/components/agents/enrollment-token-panel"
import { ActivityFeed } from "@/ux/components/patterns/activity-feed"
import { ConfirmDialog } from "@/ux/components/patterns/confirm-dialog"
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header"
import { DescriptionList, MonoValue, RelativeTime } from "@/ux/components/patterns/primitives"
import { StatusBadge } from "@/ux/components/patterns/status-badge"
import { EmptyState } from "@/ux/components/patterns/states"
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert"
import { Badge } from "@/ux/components/ui/badge"
import { Button } from "@/ux/components/ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/ux/components/ui/card"
import { Checkbox } from "@/ux/components/ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/ux/components/ui/dialog"
import { Field, FieldDescription, FieldLabel, FieldSet } from "@/ux/components/ui/field"
import { Switch } from "@/ux/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ux/components/ui/tabs"
import { DISCONNECT_REASON_META, IMPORTER_NAMES } from "@/ux/lib/domain"
import { formatDateTime } from "@/ux/lib/format"
import { useDeleteAgent, useRevokeAgent, useRotateAgent, useUpdateAgent } from "@/api/hooks/agents"
import type { AgentSession, AuditEvent, ImportAgent } from "@/ux/lib/view-types"
import { ux } from "@/ux/lib/paths"

interface AgentDetailProps {
  agent: ImportAgent
  sessions: AgentSession[]
  events: AuditEvent[]
}

function sessionDuration(s: AgentSession): string {
  if (!s.disconnectedAt) return "Active"
  const mins = Math.round((new Date(s.disconnectedAt).getTime() - new Date(s.connectedAt).getTime()) / 60000)
  if (mins < 60) return `${mins}m`
  const h = Math.floor(mins / 60)
  return h < 24 ? `${h}h ${mins % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`
}

const TABS = ["overview", "policy", "sessions", "activity"]

export function AgentDetail({ agent, sessions, events }: AgentDetailProps) {
  const navigate = useNavigate()
  const [tab, setTab] = useValidatedTab(TABS)

  const updateAgent = useUpdateAgent(agent.id)
  const rotateAgent = useRotateAgent(agent.id)
  const revokeAgent = useRevokeAgent(agent.id)
  const deleteAgent = useDeleteAgent(agent.id)

  const [token, setToken] = React.useState<string | null>(null)
  const [restricted, setRestricted] = React.useState(agent.allowedImporters.length > 0)
  const [allowed, setAllowed] = React.useState<string[]>(agent.allowedImporters)

  // Re-sync the draft policy when the live row changes (save, invalidate).
  React.useEffect(() => {
    setRestricted(agent.allowedImporters.length > 0)
    setAllowed(agent.allowedImporters)
  }, [agent.allowedImporters])

  const lastSession = sessions.find((s) => s.disconnectedAt) ?? null
  const liveSession = sessions.find((s) => !s.disconnectedAt) ?? null
  const revoked = agent.credentialState === "REVOKED"
  const pending = agent.credentialState === "PENDING_ENROLLMENT"

  const issueToken = () =>
    rotateAgent.mutate(undefined, {
      onSuccess: (result) => setToken(result.enrollment.token),
      onError: (e) => toast.error(e.message),
    })

  const savePolicy = () => {
    const next = restricted ? allowed : []
    updateAgent.mutate(
      { allowedImporters: next },
      {
        onSuccess: () =>
          toast.success("Importer policy saved. The agent picks it up on its next heartbeat."),
        onError: (e) => toast.error(e.message),
      },
    )
  }


  const policyDirty = JSON.stringify(restricted ? [...allowed].sort() : []) !== JSON.stringify([...agent.allowedImporters].sort())

  return (
    <PageContainer>
      <PageHeader
        media={
          <div className="flex size-12 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
            <RadioTowerIcon className="size-6" aria-hidden="true" />
          </div>
        }
        title={<span className="font-mono">{agent.name}</span>}
        description={flags.agentEnrolledBy && (agent as { createdBy?: string }).createdBy ? `Enrolled by ${(agent as { createdBy?: string }).createdBy} on ${formatDateTime(agent.createdAt)}` : `Created ${formatDateTime(agent.createdAt)}`}
        meta={
          <>
            <AgentStatusCell agent={agent} />
            {agent.agentVersion && <Badge variant="secondary" className="font-mono text-xs">v{agent.agentVersion}</Badge>}
          </>
        }
        actions={
          pending || revoked ? (
            <Button onClick={issueToken} disabled={rotateAgent.isPending}>{revoked ? "Issue new token" : "Reissue token"}</Button>
          ) : (
            <ConfirmDialog
              trigger={<Button variant="outline">Rotate credential</Button>}
              title="Rotate credential?"
              description="The current credential stops working immediately and the agent disconnects. You will get a new enrollment token to re-enroll it."
              confirmLabel="Rotate"
              onConfirm={issueToken}
            />
          )
        }
      />

      {agent.status === "OFFLINE" && agent.credentialState === "ACTIVE" && (
        <Alert>
          <AlertTriangleIcon />
          <AlertTitle>This agent is offline</AlertTitle>
          <AlertDescription>
            {lastSession?.reason
              ? `Last session ended: ${DISCONNECT_REASON_META[lastSession.reason].description}. `
              : ""}
            Jobs bound to this agent queue until it reconnects.
          </AlertDescription>
        </Alert>
      )}
      {pending && (
        <Alert>
          <AlertTriangleIcon />
          <AlertTitle>Waiting for first connection</AlertTitle>
          <AlertDescription>
            {agent.enrollmentExpiresAt ? (
              <>The enrollment token expires <RelativeTime iso={agent.enrollmentExpiresAt} />. </>
            ) : (
              "An unused enrollment token exists. "
            )}
            Tokens cannot be viewed again, so reissue one if it was lost.
          </AlertDescription>
        </Alert>
      )}
      {revoked && (
        <Alert variant="destructive">
          <AlertTriangleIcon />
          <AlertTitle>Credential revoked</AlertTitle>
          <AlertDescription>This agent cannot connect. Issue a new token to re-enable the identity, or delete it.</AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="policy">Policy</TabsTrigger>
          <TabsTrigger value="sessions">Sessions</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Connection</CardTitle>
              <CardDescription>Reported by the agent at handshake. Read-only in the hub.</CardDescription>
            </CardHeader>
            <CardContent>
              <DescriptionList
                items={[
                  { label: "Agent ID", value: <MonoValue value={agent.id} /> },
                  { label: "Last seen", value: agent.lastSeenAt ? <RelativeTime iso={agent.lastSeenAt} /> : "Never" },
                  { label: "Last heartbeat", value: agent.lastHeartbeatAt ? <RelativeTime iso={agent.lastHeartbeatAt} /> : "No live session" },
                  {
                    label: "Last disconnect",
                    value: agent.lastDisconnectReason ? (
                      <StatusBadge {...DISCONNECT_REASON_META[agent.lastDisconnectReason]} />
                    ) : (
                      "—"
                    ),
                  },
                  { label: "Agent version", value: agent.agentVersion ?? "—" },
                  { label: "Protocol", value: agent.protocolVersion ? `v${agent.protocolVersion}` : "—" },
                  { label: "Max concurrent jobs", value: agent.maxConcurrentJobs ?? "—" },
                  { label: "Remote address", value: liveSession?.remoteAddress ?? lastSession?.remoteAddress ?? "—" },
                  { label: "Bound configs", value: agent.boundConfigs },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Importers on this agent</CardTitle>
              <CardDescription>Compiled into the agent. The policy tab controls which ones the hub may dispatch.</CardDescription>
            </CardHeader>
            <CardContent>
              {Object.keys(agent.importerVersions).length === 0 ? (
                <EmptyState icon={RadioTowerIcon} title="No handshake yet" description="Importers appear after the agent connects for the first time." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Importer</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Policy</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(agent.importerVersions).map(([name, version]) => {
                      const isAllowed = agent.allowedImporters.length === 0 || agent.allowedImporters.includes(name)
                      return (
                        <TableRow key={name}>
                          <TableCell className="font-mono text-sm">{name}</TableCell>
                          <TableCell className="tabular font-mono text-xs text-muted-foreground">{version}</TableCell>
                          <TableCell>
                            <StatusBadge tone={isAllowed ? "success" : "neutral"} label={isAllowed ? "Allowed" : "Blocked"} />
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          <AgentOperations agent={agent} />
        </TabsContent>

        <TabsContent value="policy" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Allowed importers</CardTitle>
              <CardDescription>Hub-managed. The agent can only run importers the hub allows, even if more are compiled in.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <Field orientation="horizontal">
                <Switch id="restrict" checked={restricted} onCheckedChange={setRestricted} />
                <div className="flex flex-col gap-0.5">
                  <FieldLabel htmlFor="restrict">Restrict to selected importers</FieldLabel>
                  <FieldDescription>When off, every importer compiled into the agent is allowed.</FieldDescription>
                </div>
              </Field>
              {restricted && (
                <FieldSet>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {IMPORTER_NAMES.map((name) => (
                      <Field key={name} orientation="horizontal">
                        <Checkbox
                          id={`policy-${name}`}
                          checked={allowed.includes(name)}
                          onCheckedChange={(v) => setAllowed((prev) => (v === true ? [...prev, name] : prev.filter((i) => i !== name)))}
                        />
                        <FieldLabel htmlFor={`policy-${name}`} className="font-mono text-xs font-normal">
                          {name}
                        </FieldLabel>
                      </Field>
                    ))}
                  </div>
                </FieldSet>
              )}
            </CardContent>
            <CardFooter className="justify-end gap-2 border-t">
              <Button
                variant="ghost"
                disabled={!policyDirty}
                onClick={() => {
                  setRestricted(agent.allowedImporters.length > 0)
                  setAllowed(agent.allowedImporters)
                }}
              >
                Discard
              </Button>
              <Button
                disabled={!policyDirty || (restricted && allowed.length === 0) || updateAgent.isPending}
                onClick={savePolicy}
              >
                Save policy
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>

        <TabsContent value="sessions" className="mt-4">
          <Card className="overflow-hidden py-0">
            {sessions.length === 0 ? (
              <EmptyState icon={HistoryIcon} title="No sessions yet" description="Connection history appears after the agent first connects." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    <TableHead className="pl-4">Connected</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Ended because</TableHead>
                    <TableHead>Remote address</TableHead>
                    <TableHead className="pr-4">Version</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sessions.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="pl-4 text-sm">{formatDateTime(s.connectedAt)}</TableCell>
                      <TableCell className="tabular text-sm">
                        {s.disconnectedAt ? sessionDuration(s) : <StatusBadge tone="success" label="Active" pulse />}
                      </TableCell>
                      <TableCell>
                        {s.reason ? <StatusBadge {...DISCONNECT_REASON_META[s.reason]} /> : <span className="text-sm text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{s.remoteAddress}</TableCell>
                      <TableCell className="pr-4 font-mono text-xs text-muted-foreground">{s.agentVersion}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <Card>
            <CardContent>
              {events.length === 0 ? (
                <EmptyState icon={HistoryIcon} title="No activity recorded" description="Enrollment, rotation and revocation events show up here." />
              ) : (
                <ActivityFeed events={events} />
              )}
            </CardContent>
            <CardFooter className="border-t">
              <Button variant="link" asChild className="px-0">
                <Link to={ux("/activity")}>Open full audit log</Link>
              </Button>
            </CardFooter>
          </Card>
        </TabsContent>
      </Tabs>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle>Danger zone</CardTitle>
          <CardDescription>Destructive actions are kept here, away from everyday controls, and always ask for confirmation.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col divide-y">
          {!revoked && (
            <div className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">Revoke credential</span>
                <span className="text-sm text-muted-foreground">Kills the live session now. Rotate to bring this identity back.</span>
              </div>
              <ConfirmDialog
                trigger={<Button variant="outline">Revoke</Button>}
                title={`Revoke ${agent.name}?`}
                description="The agent is disconnected immediately and cannot reconnect until you issue a new token."
                confirmLabel="Revoke credential"
                typeToConfirm={agent.name}
                onConfirm={() =>
                  revokeAgent.mutate(undefined, {
                    onSuccess: () => toast.success(`${agent.name} revoked`),
                    onError: (e) => toast.error(e.message),
                  })
                }
              />
            </div>
          )}
          <div className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">Delete agent</span>
              <span className="text-sm text-muted-foreground">
                {agent.boundConfigs > 0
                  ? `Unbind the ${agent.boundConfigs} importer config${agent.boundConfigs === 1 ? "" : "s"} using this agent before deleting it.`
                  : "Removes the identity and its session history."}
              </span>
            </div>
            <ConfirmDialog
              trigger={
                <Button variant="destructive" disabled={agent.boundConfigs > 0}>
                  Delete agent
                </Button>
              }
              title={`Delete ${agent.name}?`}
              description="The identity, credential and session history are removed permanently."
              confirmLabel="Delete agent"
              typeToConfirm={agent.name}
              onConfirm={() =>
                deleteAgent.mutate(undefined, {
                  onSuccess: () => {
                    toast.success(`${agent.name} deleted`)
                    navigate(ux("/agents"))
                  },
                  onError: (e) => toast.error(e.message),
                })
              }
            />
          </div>
        </CardContent>
      </Card>

      <Dialog open={token !== null} onOpenChange={() => undefined}>
        <DialogContent
          className="sm:max-w-lg"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>New enrollment token</DialogTitle>
            <DialogDescription>
              Run this on the agent host to re-enroll <span className="font-mono">{agent.name}</span>.
            </DialogDescription>
          </DialogHeader>
          {token && <EnrollmentTokenPanel agentName={agent.name} token={token} onDone={() => setToken(null)} />}
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
