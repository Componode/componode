import { useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { KeyRound, Trash2, Ban, Save } from "lucide-react";
import {
  useAgent,
  useAgentConfigs,
  useAgentRuns,
  useAgentSessions,
  useDeleteAgent,
  useRevokeAgent,
  useRotateAgent,
  useUpdateAgent,
} from "@/api/hooks/agents";
import { AgentEnrollmentDialog } from "@/components/agent-enrollment-dialog";
import { StatusBadge } from "@/components/states/status-badge";
import { ErrorState } from "@/components/states/error-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { describeApiError, type ApiError } from "@/api/client";
import { relativeTime, absoluteTime } from "@/lib/format";
import { parseImporterCsv } from "@/lib/utils";
import type { EnrollmentGrant } from "@/api/types";

// Import Agent detail (spec 025 US3/US4 + 027 US5): overview w/ editable
// policy + lifecycle actions + in-flight jobs, bound configs, agent runs,
// and connection history.
export function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isPending, error, refetch } = useAgent(id ?? null);
  const sessions = useAgentSessions(id ?? null);
  const boundConfigs = useAgentConfigs(id ?? null);
  const agentRuns = useAgentRuns(id ?? null);
  const update = useUpdateAgent(id ?? "");
  const rotate = useRotateAgent(id ?? "");
  const revoke = useRevokeAgent(id ?? "");
  const del = useDeleteAgent(id ?? "");

  const [tab, setTab] = useState<"overview" | "configs" | "runs" | "history">(
    "overview",
  );
  const [importers, setImporters] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<EnrollmentGrant | null>(null);
  const [confirmAction, setConfirmAction] = useState<
    "revoke" | "delete" | null
  >(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const agent = data?.agent;

  if (isPending) {
    return <div className="p-6 text-muted-foreground">Loading…</div>;
  }
  if (error || !agent) {
    return <ErrorState onRetry={() => refetch()} />;
  }

  const importersValue = importers ?? agent.allowedImporters.join(", ");

  async function savePolicy() {
    setFormError(null);
    const allowedImporters = parseImporterCsv(importersValue ?? "");
    try {
      await update.mutateAsync({ allowedImporters });
      setImporters(null);
    } catch (err) {
      setFormError(describeApiError(err as ApiError, "Update failed"));
    }
  }

  async function confirmRevoke() {
    setActionError(null);
    try {
      await revoke.mutateAsync();
      setConfirmAction(null);
    } catch (err) {
      setActionError(describeApiError(err as ApiError, "Revoke failed"));
    }
  }

  async function confirmDelete() {
    setActionError(null);
    try {
      await del.mutateAsync();
      setConfirmAction(null);
      navigate("/agents");
    } catch (err) {
      setActionError(describeApiError(err as ApiError, "Delete failed"));
    }
  }

  async function doRotate() {
    setActionError(null);
    try {
      const result = await rotate.mutateAsync();
      setEnrollment({ agentName: agent!.name, enrollment: result.enrollment });
    } catch (err) {
      setActionError(describeApiError(err as ApiError, "Rotation failed"));
    }
  }

  return (
    <div className="bg-background p-6">
      <div className="mb-2 text-sm text-muted-foreground">
        <Link to="/agents" className="hover:underline">
          Import Agents
        </Link>{" "}
        / {agent.name}
      </div>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-2xl font-bold">{agent.name}</h1>
        <StatusBadge status={agent.status} />
        {agent.revokedAt && <StatusBadge status="REVOKED" />}
      </div>

      <div className="mb-6 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void doRotate()}
          disabled={rotate.isPending}
        >
          <KeyRound className="mr-1 h-4 w-4" /> Rotate credential
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setConfirmAction("revoke")}
          disabled={agent.revokedAt !== null}
        >
          <Ban className="mr-1 h-4 w-4" /> Revoke
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setConfirmAction("delete")}
        >
          <Trash2 className="mr-1 h-4 w-4" /> Delete
        </Button>
      </div>
      {actionError && (
        <p className="mb-4 text-sm text-destructive">{actionError}</p>
      )}

      <div className="mb-6 flex gap-4 border-b">
        {(["overview", "configs", "runs", "history"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2 text-sm capitalize ${
              tab === t
                ? "border-b-2 border-primary font-medium"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "history" ? "Connection history" : t}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <div className="max-w-2xl space-y-6">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm">
            <dt className="text-muted-foreground">Agent version</dt>
            <dd>
              {agent.agentVersion ?? "—"}{" "}
              <span className="text-xs text-muted-foreground">
                (agent-reported)
              </span>
            </dd>
            <dt className="text-muted-foreground">Protocol version</dt>
            <dd>
              {agent.protocolVersion ?? "—"}{" "}
              <span className="text-xs text-muted-foreground">
                (agent-reported)
              </span>
            </dd>
            <dt className="text-muted-foreground">Importers</dt>
            <dd>
              {agent.importerVersions.length === 0
                ? "—"
                : agent.importerVersions
                    .map((i) => `${i.name}@${i.version}`)
                    .join(", ")}
            </dd>
            <dt className="text-muted-foreground">Max concurrent jobs</dt>
            <dd>
              {agent.maxConcurrentJobs ?? "—"}{" "}
              <span className="text-xs text-muted-foreground">
                (agent-reported)
              </span>
            </dd>
            <dt className="text-muted-foreground">Bound configs</dt>
            <dd>{agent.boundConfigCount}</dd>
            <dt className="text-muted-foreground">Running jobs</dt>
            <dd>{agent.runningJobs}</dd>
            <dt className="text-muted-foreground">Last seen</dt>
            <dd
              title={
                agent.lastSeenAt ? absoluteTime(agent.lastSeenAt) : undefined
              }
            >
              {agent.lastSeenAt ? relativeTime(agent.lastSeenAt) : "never"}
            </dd>
            <dt className="text-muted-foreground">Credential</dt>
            <dd>
              {agent.hasCredential ? "issued" : "not enrolled"}
              {agent.pendingEnrollment && " · enrollment pending"}
            </dd>
            <dt className="text-muted-foreground">Created</dt>
            <dd>{absoluteTime(agent.createdAt)}</dd>
          </dl>

          <div className="space-y-2">
            <Label htmlFor="allowed-importers">Allowed importers</Label>
            <div className="flex gap-2">
              <Input
                id="allowed-importers"
                value={importersValue}
                onChange={(e) => setImporters(e.target.value)}
                placeholder="github, kubernetes — empty means all"
                className="max-w-md"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => void savePolicy()}
                disabled={update.isPending || importers === null}
              >
                <Save className="mr-1 h-4 w-4" /> Save
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Hub-managed policy (ADR-116): which importers this agent may run.
              Empty allows every compiled importer. Unknown names are rejected.
            </p>
            {formError && (
              <p className="text-sm text-destructive">{formError}</p>
            )}
          </div>

          {/* In-flight jobs (spec 027 US5): hub-side dispatch map state —
              what this agent is believed to be executing right now. */}
          <div className="space-y-2">
            <h2 className="text-sm font-medium">In-flight jobs</h2>
            {agent.activeRuns.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No jobs in flight.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Config</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Phase</TableHead>
                    <TableHead>Started</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agent.activeRuns.map((r) => (
                    <TableRow key={r.runId}>
                      <TableCell>
                        <Link
                          to={`/importers/${r.configId}/runs/${r.runId}`}
                          className="text-primary hover:underline"
                        >
                          {r.configLabel}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {r.state === "ASSIGNED" ? "Assigned" : "Running"}
                      </TableCell>
                      <TableCell>{r.phase ?? "—"}</TableCell>
                      <TableCell
                        title={
                          r.startedAt ? absoluteTime(r.startedAt) : undefined
                        }
                      >
                        {r.startedAt ? relativeTime(r.startedAt) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      ) : tab === "configs" ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Config</TableHead>
              <TableHead>Importer</TableHead>
              <TableHead>Schedule</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(boundConfigs.data?.configs ?? []).map((c) => (
              <TableRow key={c.id}>
                <TableCell>
                  <Link
                    to={`/importers?config=${c.id}`}
                    className="text-primary hover:underline"
                  >
                    {c.label}
                  </Link>
                </TableCell>
                <TableCell>{c.importerName}</TableCell>
                <TableCell>{c.schedule ?? "manual"}</TableCell>
                <TableCell>
                  {!c.enabled ? (
                    <span className="text-muted-foreground">Disabled</span>
                  ) : c.agentIncompatible ? (
                    <StatusBadge status="INCOMPATIBLE" />
                  ) : (
                    <span className="text-muted-foreground">Ready</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {(boundConfigs.data?.configs ?? []).length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={4}
                  className="text-center text-muted-foreground"
                >
                  No configs bound to this agent
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      ) : tab === "runs" ? (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Config</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Phase / error</TableHead>
              <TableHead>Assets</TableHead>
              <TableHead>Started</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(agentRuns.data?.runs ?? []).map((r) => (
              <TableRow key={r.id}>
                <TableCell>
                  <Link
                    to={`/importers/${r.configId}/runs/${r.id}`}
                    className="text-primary hover:underline"
                  >
                    {r.configLabel}
                  </Link>
                </TableCell>
                <TableCell>
                  <StatusBadge status={r.status} />
                </TableCell>
                <TableCell className="text-xs">
                  {r.errorType ?? r.currentPhase ?? "—"}
                </TableCell>
                <TableCell>{r.assetsProcessed}</TableCell>
                <TableCell
                  title={r.startedAt ? absoluteTime(r.startedAt) : undefined}
                >
                  {r.startedAt ? relativeTime(r.startedAt) : "—"}
                </TableCell>
              </TableRow>
            ))}
            {(agentRuns.data?.runs ?? []).length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground"
                >
                  No runs executed by this agent yet
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Connected</TableHead>
              <TableHead>Disconnected</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Remote address</TableHead>
              <TableHead>Versions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(sessions.data?.sessions ?? []).map((s) => (
              <TableRow key={s.id}>
                <TableCell title={absoluteTime(s.connectedAt)}>
                  {relativeTime(s.connectedAt)}
                </TableCell>
                <TableCell
                  title={
                    s.disconnectedAt
                      ? absoluteTime(s.disconnectedAt)
                      : undefined
                  }
                >
                  {s.disconnectedAt ? relativeTime(s.disconnectedAt) : "live"}
                </TableCell>
                <TableCell>{s.disconnectReason ?? "—"}</TableCell>
                <TableCell className="font-mono text-xs">
                  {s.remoteAddress ?? "—"}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  agent {s.agentVersion ?? "?"} · protocol{" "}
                  {s.protocolVersion ?? "?"}
                </TableCell>
              </TableRow>
            ))}
            {(sessions.data?.sessions ?? []).length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground"
                >
                  No connection history
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      )}

      {/* Revoke confirm */}
      <Dialog
        open={confirmAction === "revoke"}
        onOpenChange={(o) => !o && setConfirmAction(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke agent credential</DialogTitle>
            <DialogDescription>
              Immediately invalidates the durable credential and drops the live
              session for &quot;{agent.name}&quot;. Re-enable by rotating a new
              enrollment token.
            </DialogDescription>
          </DialogHeader>
          {actionError && (
            <p className="text-sm text-destructive">{actionError}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmRevoke()}
              disabled={revoke.isPending}
            >
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog
        open={confirmAction === "delete"}
        onOpenChange={(o) => !o && setConfirmAction(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete import agent</DialogTitle>
            <DialogDescription>
              Deletes &quot;{agent.name}&quot; and its connection history.
              Importer configs bound to this agent must be unbound first —
              delete is blocked while any remain.
            </DialogDescription>
          </DialogHeader>
          {actionError && (
            <p className="text-sm text-destructive">{actionError}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmAction(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => void confirmDelete()}
              disabled={del.isPending}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AgentEnrollmentDialog
        open={enrollment !== null}
        onClose={() => setEnrollment(null)}
        agentName={enrollment?.agentName ?? ""}
        enrollment={enrollment?.enrollment ?? null}
      />
    </div>
  );
}
