import { useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Satellite } from "lucide-react";
import { useAgents, useCreateAgent } from "@/api/hooks/agents";
import { AgentEnrollmentDialog } from "@/components/agent-enrollment-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableSkeleton } from "@/components/states/skeletons";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Forbidden } from "@/components/states/forbidden";
import { StatusBadge } from "@/components/states/status-badge";
import { describeApiError, type ApiError } from "@/api/client";
import { relativeTime, absoluteTime } from "@/lib/format";
import { parseImporterCsv } from "@/lib/utils";
import type { EnrollmentGrant } from "@/api/types";

export function AgentsPage() {
  const { data, isPending, error, refetch } = useAgents();
  const create = useCreateAgent();
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [importers, setImporters] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<EnrollmentGrant | null>(null);

  const agents = data?.agents ?? [];
  const isForbidden = error
    ? (error as unknown as ApiError).code === "AUTH_FORBIDDEN"
    : false;

  async function submit() {
    setFormError(null);
    const allowedImporters = parseImporterCsv(importers);
    try {
      const result = await create.mutateAsync({
        name: name.trim(),
        ...(allowedImporters.length > 0 ? { allowedImporters } : {}),
      });
      setShowForm(false);
      setName("");
      setImporters("");
      setEnrollment({
        agentName: result.agent.name,
        enrollment: result.enrollment,
      });
    } catch (err) {
      setFormError(describeApiError(err as ApiError, "Failed to create agent"));
    }
  }

  if (isForbidden) {
    return <Forbidden />;
  }

  return (
    <div className="bg-background p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Import Agents</h1>
        {!showForm && (
          <Button onClick={() => setShowForm(true)}>
            <Plus className="mr-1 h-4 w-4" /> New agent
          </Button>
        )}
      </div>

      {showForm && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">New import agent</CardTitle>
          </CardHeader>
          <CardContent>
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <div className="space-y-2">
                <Label htmlFor="agent-name">Name</Label>
                <Input
                  id="agent-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="edge-agent-eu"
                  pattern="^[a-z0-9]([a-z0-9-]*[a-z0-9])?$"
                  maxLength={63}
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Lowercase alphanumeric with hyphens — used in install commands
                  and audit entries.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="agent-importers">Allowed importers</Label>
                <Input
                  id="agent-importers"
                  value={importers}
                  onChange={(e) => setImporters(e.target.value)}
                  placeholder="github, kubernetes — leave empty for all"
                />
                <p className="text-xs text-muted-foreground">
                  Comma-separated importer names. Empty means the agent may run
                  every compiled importer.
                </p>
              </div>
              {formError && (
                <p className="text-sm text-destructive">{formError}</p>
              )}
              <div className="flex gap-2">
                <Button type="submit" disabled={create.isPending}>
                  Create agent
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowForm(false)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {isPending ? (
        <TableSkeleton />
      ) : error ? (
        <ErrorState onRetry={() => refetch()} />
      ) : agents.length === 0 ? (
        <EmptyState
          icon={Satellite}
          title="No import agents"
          description="Deploy an agent inside a restricted network to run importers the hub cannot reach."
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Version</TableHead>
              <TableHead>Bound configs</TableHead>
              <TableHead>Running jobs</TableHead>
              <TableHead>Allowed importers</TableHead>
              <TableHead>Last seen</TableHead>
              <TableHead>Last disconnect</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.map((agent) => (
              <TableRow key={agent.id}>
                <TableCell>
                  <Link
                    to={`/agents/${agent.id}`}
                    className="font-medium text-primary hover:underline"
                  >
                    {agent.name}
                  </Link>
                  {agent.revokedAt && (
                    <span className="ml-2 text-xs text-destructive">
                      revoked
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <StatusBadge status={agent.status} />
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {agent.agentVersion ?? "—"}
                </TableCell>
                <TableCell>{agent.boundConfigCount}</TableCell>
                <TableCell>{agent.runningJobs}</TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {agent.allowedImporters.length === 0
                    ? "all"
                    : agent.allowedImporters.join(", ")}
                </TableCell>
                <TableCell
                  className="text-sm text-muted-foreground"
                  title={
                    agent.lastSeenAt
                      ? absoluteTime(agent.lastSeenAt)
                      : undefined
                  }
                >
                  {agent.lastSeenAt ? relativeTime(agent.lastSeenAt) : "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {agent.lastDisconnectReason ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <AgentEnrollmentDialog
        open={enrollment !== null}
        onClose={() => setEnrollment(null)}
        agentName={enrollment?.agentName ?? ""}
        enrollment={enrollment?.enrollment ?? null}
      />
    </div>
  );
}
