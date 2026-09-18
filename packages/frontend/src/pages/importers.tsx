import { useState } from "react";
import { Plus, Play, Trash2, Edit, Eye, ChevronDown, ChevronUp, Import, KeyRound } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { useSession } from "@/api/hooks/auth";
import {
  useImporters,
  useImporterConfigs,
  useCreateImporterConfig,
  useUpdateImporterConfig,
  useDeleteImporterConfig,
  useConvertSecrets,
  useTriggerImportRun,
  useImporterRuns,
} from "@/api/hooks/importers";
import { ImporterConfigForm } from "@/components/importer-config-form";
import type { ImporterConfigFormOutput } from "@/components/importer-config-form";
import type { ImporterManifest, ImporterConfig, ImportRun } from "@/api/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CardGridSkeleton, TableSkeleton } from "@/components/states/skeletons";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Forbidden } from "@/components/states/forbidden";
import { StatusBadge } from "@/components/states/status-badge";
import { relativeTime, absoluteTime } from "@/lib/format";
import type { ApiError } from "@/api/client";

const ROLE_LEVEL: Record<string, number> = {
  VIEWER: 0,
  EDITOR: 1,
  ADMIN: 2,
};

function hasRole(userRole: string | undefined, required: "EDITOR" | "ADMIN"): boolean {
  const userLevel = ROLE_LEVEL[userRole ?? "VIEWER"] ?? 0;
  const requiredLevel = ROLE_LEVEL[required] ?? 0;
  return userLevel >= requiredLevel;
}

function isForbiddenError(err: unknown): boolean {
  return (err as ApiError).code === "FORBIDDEN";
}

interface ConfigDialogProps {
  mode: "create" | "edit";
  config?: ImporterConfig | null;
  manifests: ImporterManifest[];
  onClose: () => void;
}

function ConfigDialog({ mode, config, manifests, onClose }: ConfigDialogProps) {
  const create = useCreateImporterConfig();
  const update = useUpdateImporterConfig();
  const convertSecrets = useConvertSecrets();
  const isPending = create.isPending || update.isPending || convertSecrets.isPending;

  async function handleSubmit(values: ImporterConfigFormOutput) {
    if (mode === "edit" && config) {
      await update.mutateAsync({ id: config.id, ...values });
    } else {
      await create.mutateAsync(values);
    }
    onClose();
  }

  async function handleConvert() {
    if (!config) return;
    const res = await convertSecrets.mutateAsync(config.id);
    toast.success(`Secrets moved to credential "${res.credential.label}"`);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add importer" : "Edit importer"}</DialogTitle>
          <DialogDescription>
            Configure how Componode discovers components from an external source.
          </DialogDescription>
        </DialogHeader>
        <ImporterConfigForm
          mode={mode}
          config={config}
          manifests={manifests}
          isPending={isPending}
          onSubmit={handleSubmit}
          onCancel={onClose}
          onConvertSecrets={config?.secretRefsDeprecated ? handleConvert : undefined}
        />
      </DialogContent>
    </Dialog>
  );
}

interface RunsPanelProps {
  config: ImporterConfig;
}

function RunsPanel({ config }: RunsPanelProps) {
  const { data, isPending, isFetching, error, refetch } = useImporterRuns(config.id);
  const runs = data?.runs ?? [];

  return (
    <div className="mt-4 rounded-md border bg-muted/30 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold">Recent runs</h3>
        {isFetching && runs.length > 0 && (
          <span className="text-xs text-muted-foreground">Updating…</span>
        )}
      </div>

      {isPending && runs.length === 0 && <TableSkeleton rows={3} columns={10} />}

      {!isPending && error && (
        <ErrorState error={error} onRetry={() => refetch()} title="Failed to load runs" />
      )}

      {!isPending && !error && runs.length === 0 && (
        <EmptyState
          icon={Import}
          title="No runs yet"
          description="Run this importer to start importing components."
          className="py-8"
        />
      )}

      {!isPending && !error && runs.length > 0 && (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Phase</TableHead>
                <TableHead>Processed</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Updated</TableHead>
                <TableHead>Orphaned</TableHead>
                <TableHead>Retired</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Completed</TableHead>
                <TableHead className="w-24">View</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((run: ImportRun) => (
                <TableRow key={run.id}>
                  <TableCell>
                    <StatusBadge status={run.status} />
                  </TableCell>
                  <TableCell className="max-w-[200px] truncate">
                    {run.currentPhase ?? "—"}
                  </TableCell>
                  <TableCell>{run.assetsProcessed}</TableCell>
                  <TableCell>{run.assetsCreated}</TableCell>
                  <TableCell>{run.assetsUpdated}</TableCell>
                  <TableCell>{run.instancesOrphaned}</TableCell>
                  <TableCell>{run.componentsRetired}</TableCell>
                  <TableCell>
                    <span title={absoluteTime(run.createdAt)}>
                      {relativeTime(run.createdAt)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span title={absoluteTime(run.completedAt)}>
                      {relativeTime(run.completedAt)}
                    </span>
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={`/importers/${config.id}/runs/${run.id}`}>
                        <Eye className="w-4 h-4" />
                        <span className="sr-only">View run</span>
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {runs[0]?.errorMessage && (
            <p className="mt-3 text-sm text-destructive">{runs[0].errorMessage}</p>
          )}
        </>
      )}
    </div>
  );
}

export function ImportersPage() {
  const { data: user } = useSession();
  const userRole = user?.role ?? "VIEWER";

  const {
    data: importersData,
    isPending: importersPending,
    isFetching: importersFetching,
    error: importersError,
    refetch: refetchImporters,
  } = useImporters();
  const {
    data: configsData,
    isPending: configsPending,
    isFetching: configsFetching,
    error: configsError,
    refetch: refetchConfigs,
  } = useImporterConfigs();

  const trigger = useTriggerImportRun();
  const deleteConfig = useDeleteImporterConfig();
  const convertSecrets = useConvertSecrets();

  const [dialogMode, setDialogMode] = useState<"create" | "edit" | null>(null);
  const [editingConfig, setEditingConfig] = useState<ImporterConfig | null>(null);
  const [expandedConfigId, setExpandedConfigId] = useState<string | null>(null);

  const configs = configsData?.configs ?? [];
  const manifests = importersData?.importers ?? [];

  const isPending = importersPending || configsPending;
  const isFetching = importersFetching || configsFetching;
  const error = importersError || configsError;

  function startCreate() {
    setEditingConfig(null);
    setDialogMode("create");
  }

  function startEdit(config: ImporterConfig) {
    setEditingConfig(config);
    setDialogMode("edit");
  }

  function closeDialog() {
    setDialogMode(null);
    setEditingConfig(null);
  }

  async function handleTrigger(config: ImporterConfig) {
    try {
      await trigger.mutateAsync(config.id);
      setExpandedConfigId(config.id);
    } catch {
      // no-op; errors surface in the runs panel
    }
  }

  async function handleDelete(config: ImporterConfig) {
    if (!confirm(`Delete importer "${config.label}"?`)) return;
    try {
      await deleteConfig.mutateAsync(config.id);
    } catch {
      // ignore
    }
  }

  async function handleConvert(config: ImporterConfig) {
    try {
      const res = await convertSecrets.mutateAsync(config.id);
      toast.success(`Secrets moved to credential "${res.credential.label}"`);
    } catch (err) {
      toast.error((err as ApiError).message ?? "Conversion failed");
    }
  }

  function handleRetry() {
    if (importersError) refetchImporters();
    if (configsError) refetchConfigs();
  }

  const isForbidden = (importersError && isForbiddenError(importersError)) ||
    (configsError && isForbiddenError(configsError));

  return (
    <div className="bg-background p-6">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Importers</h1>
        <div className="flex items-center gap-2">
          {isFetching && !isPending && (
            <span className="text-sm text-muted-foreground">Updating…</span>
          )}
          {hasRole(userRole, "ADMIN") && (
            <Button onClick={startCreate}>
              <Plus className="w-4 h-4 mr-2" />
              Add importer
            </Button>
          )}
        </div>
      </div>

      {isPending && configs.length === 0 && <CardGridSkeleton cards={3} />}

      {!isPending && isForbidden && <Forbidden />}

      {!isPending && !isForbidden && error && (
        <ErrorState error={error} onRetry={handleRetry} />
      )}

      {!isPending && !error && configs.length === 0 && (
        <EmptyState
          icon={Import}
          title="No importers configured yet"
          description="Add an importer to start importing components."
          action={
            hasRole(userRole, "ADMIN")
              ? { label: "Add importer", onClick: startCreate }
              : undefined
          }
        />
      )}

      {!isPending && !error && configs.length > 0 && (
        <div className="space-y-4">
          {configs.map((config) => {
            const expanded = expandedConfigId === config.id;
            return (
              <Card key={config.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <CardTitle>{config.label}</CardTitle>
                        {config.secretRefsDeprecated && (
                          <Badge variant="secondary">DEPRECATED SECRETS</Badge>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {config.importerName} · {config.enabled ? "Enabled" : "Disabled"}
                        {config.schedule ? ` · ${config.schedule}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {hasRole(userRole, "EDITOR") && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleTrigger(config)}
                          disabled={trigger.isPending}
                        >
                          <Play className="w-4 h-4 mr-1" />
                          Run
                        </Button>
                      )}
                      {hasRole(userRole, "ADMIN") && (
                        <>
                          {config.secretRefsDeprecated && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleConvert(config)}
                              disabled={convertSecrets.isPending}
                            >
                              <KeyRound className="w-4 h-4 mr-1" />
                              Convert secrets
                            </Button>
                          )}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => startEdit(config)}
                          >
                            <Edit className="w-4 h-4" />
                            <span className="sr-only">Edit</span>
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDelete(config)}
                            disabled={deleteConfig.isPending}
                          >
                            <Trash2 className="w-4 h-4 text-destructive" />
                            <span className="sr-only">Delete</span>
                          </Button>
                        </>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpandedConfigId(expanded ? null : config.id)}
                      >
                        {expanded ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                        <span className="sr-only">{expanded ? "Collapse" : "Expand"}</span>
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                {expanded && (
                  <CardContent>
                    <RunsPanel config={config} />
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {dialogMode && (
        <ConfigDialog
          mode={dialogMode}
          config={editingConfig}
          manifests={manifests}
          onClose={closeDialog}
        />
      )}
    </div>
  );
}
