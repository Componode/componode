import { Link, useParams } from "react-router-dom";
import { ArrowLeft, RefreshCw, Square, Clock } from "lucide-react";
import {
  useImporterRun,
  useCancelImportRun,
  useImportRunErrors,
} from "@/api/hooks/importers";
import { useCredentials } from "@/api/hooks/credentials";
import { useRunChanges } from "@/api/hooks/audit";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { PageSkeleton, TableSkeleton } from "@/components/states/skeletons";
import { ErrorState } from "@/components/states/error-state";
import { Forbidden } from "@/components/states/forbidden";
import { StatusBadge } from "@/components/states/status-badge";
import { relativeTime, absoluteTime, MONO_CLASS } from "@/lib/format";
import { useSetCrumbLabel } from "@/components/layout/crumb-context";
import type { ImportRunError } from "@/api/types";
import type { ApiError } from "@/api/client";

export function ImporterRunPage() {
  const { configId, runId } = useParams<{
    configId: string;
    runId: string;
  }>();

  const {
    data,
    isPending,
    isFetching,
    error,
    refetch,
  } = useImporterRun(configId ?? null, runId ?? null);
  const {
    data: errorsData,
    isPending: errorsPending,
    isFetching: errorsFetching,
    error: errorsError,
    refetch: refetchErrors,
  } = useImportRunErrors(configId ?? null, runId ?? null);
  const {
    data: changesData,
    isPending: changesPending,
    isFetching: changesFetching,
    error: changesError,
    refetch: refetchChanges,
  } = useRunChanges(configId ?? "", runId ?? "");
  const cancel = useCancelImportRun();
  const { data: credentialsData } = useCredentials();

  const run = data?.run;
  const usedCredentials = (run?.credentialIds ?? [])
    .map((id) => credentialsData?.credentials.find((c) => c.id === id))
    .filter((c) => c !== undefined);
  const errors = errorsData?.errors ?? [];
  const changes = changesData?.changes ?? [];
  useSetCrumbLabel(runId ? `run-${runId.slice(-8)}` : null);

  const isActive = run?.status === "PENDING" || run?.status === "RUNNING";
  const isForbidden = error ? ((error as unknown) as ApiError).code === "FORBIDDEN" : false;

  return (
    <div className="bg-background p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/importers">
              <ArrowLeft className="w-4 h-4 mr-1" />
              Back to importers
            </Link>
          </Button>
        </div>

        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Import run</h1>
          {isActive && (
            <Button
              variant="destructive"
              size="sm"
              onClick={() => {
                if (configId && runId) {
                  cancel.mutate({ configId, runId });
                }
              }}
              disabled={cancel.isPending}
            >
              <Square className="w-4 h-4 mr-1" />
              Cancel
            </Button>
          )}
        </div>

        {isPending && !run && <PageSkeleton />}

        {!isPending && isForbidden && <Forbidden />}

        {!isPending && !isForbidden && error && (
          <ErrorState error={error} onRetry={() => refetch()} />
        )}

        {!isPending && !error && !run && (
          <ErrorState
            title="Run not found"
            onRetry={() => refetch()}
          />
        )}

        {!isPending && !error && run && (
          <>
            {isFetching && (
              <p className="text-xs text-muted-foreground">Updating…</p>
            )}

            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Status</CardTitle>
                  <StatusBadge status={run.status} />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {run.currentPhase && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <RefreshCw className={cn("w-4 h-4", isActive && "animate-spin")} />
                    <span className="font-medium text-foreground">{run.currentPhase}</span>
                  </div>
                )}

                {run.errorMessage && (
                  <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                    <span>{run.errorMessage}</span>
                  </div>
                )}

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <Stat label="Processed" value={run.assetsProcessed} />
                  <Stat label="Created" value={run.assetsCreated} />
                  <Stat label="Updated" value={run.assetsUpdated} />
                  <Stat label="Orphaned" value={run.instancesOrphaned} />
                  <Stat label="Retired" value={run.componentsRetired} />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm pt-2 border-t">
                  <DateField label="Created" value={run.createdAt} />
                  <DateField label="Started" value={run.startedAt} />
                  <DateField label="Completed" value={run.completedAt} />
                </div>

                {(run.credentialIds?.length ?? 0) > 0 && (
                  <div className="flex items-center gap-2 text-sm pt-2 border-t">
                    <span className="text-muted-foreground">Credentials used:</span>
                    {usedCredentials.length > 0 ? (
                      <span className="flex flex-wrap gap-1">
                        {usedCredentials.map((cred) => (
                          <Link
                            key={cred.id}
                            to="/credentials"
                            className="rounded-md border px-2 py-0.5 text-xs hover:bg-accent"
                          >
                            {cred.label}
                          </Link>
                        ))}
                      </span>
                    ) : (
                      <span>{run.credentialIds!.length} credential(s)</span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Run errors</CardTitle>
              </CardHeader>
              <CardContent>
                {errorsPending && errors.length === 0 && <TableSkeleton rows={3} columns={4} />}

                {!errorsPending && errorsError && (
                  <ErrorState
                    error={errorsError}
                    onRetry={() => refetchErrors()}
                    title="Failed to load run errors"
                  />
                )}

                {!errorsPending && !errorsError && errors.length === 0 && (
                  <p className="text-sm text-muted-foreground">No run errors.</p>
                )}

                {!errorsPending && !errorsError && errors.length > 0 && (
                  <>
                    {errorsFetching && (
                      <p className="mb-2 text-xs text-muted-foreground">Updating…</p>
                    )}
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Asset</TableHead>
                          <TableHead>Type</TableHead>
                          <TableHead>Message</TableHead>
                          <TableHead>Time</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {errors.map((err: ImportRunError) => (
                          <TableRow key={err.id}>
                            <TableCell>
                              <span className={MONO_CLASS}>
                                {err.assetExternalId ?? "—"}
                              </span>
                            </TableCell>
                            <TableCell>{err.errorType}</TableCell>
                            <TableCell className="max-w-md truncate">
                              {err.errorMessage}
                            </TableCell>
                            <TableCell>
                              <span title={absoluteTime(err.createdAt)}>
                                {relativeTime(err.createdAt)}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Changes produced by this run</CardTitle>
              </CardHeader>
              <CardContent>
                {changesPending && changes.length === 0 && <TableSkeleton rows={3} columns={4} />}

                {!changesPending && changesError && (
                  <ErrorState
                    error={changesError}
                    onRetry={() => refetchChanges()}
                    title="Failed to load run changes"
                  />
                )}

                {!changesPending && !changesError && changes.length === 0 && (
                  <p className="text-sm text-muted-foreground">No recorded changes for this run.</p>
                )}

                {!changesPending && !changesError && changes.length > 0 && (
                  <>
                    {changesFetching && (
                      <p className="mb-2 text-xs text-muted-foreground">Updating…</p>
                    )}
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Entity type</TableHead>
                          <TableHead>Action</TableHead>
                          <TableHead>Actor</TableHead>
                          <TableHead>Time</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {changes.map((change) => (
                          <TableRow key={change.id}>
                            <TableCell className="capitalize">{change.entityType.replace(/_/g, " ")}</TableCell>
                            <TableCell>{change.action}</TableCell>
                            <TableCell>{change.createdByName ?? change.createdBy ?? "system"}</TableCell>
                            <TableCell>
                              <span title={absoluteTime(change.createdAt)}>
                                {relativeTime(change.createdAt)}
                              </span>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </>
                )}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );
}

function DateField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-center gap-2">
      <Clock className="w-4 h-4 text-muted-foreground" />
      <span className="text-muted-foreground">{label}:</span>
      <span title={absoluteTime(value)}>{relativeTime(value)}</span>
    </div>
  );
}
