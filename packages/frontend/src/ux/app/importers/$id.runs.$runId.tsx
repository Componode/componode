import { useParams } from "react-router-dom";
import { useRunChanges } from "@/api/hooks/audit";
import { useCredentials } from "@/api/hooks/credentials";
import { useImporterConfig, useImporterRun, useImportRunErrors } from "@/api/hooks/importers";
import { mapImporterConfig, mapImportRun, mapRunChange, mapRunError } from "@/api/mappers/operations";
import { RunDetail } from "@/ux/components/importers/run-detail";
import { PageContainer } from "@/ux/components/patterns/page-header";
import { ErrorState, ForbiddenState, NotFoundState, TableSkeleton } from "@/ux/components/patterns/states";
import { Card } from "@/ux/components/ui/card";
import { errorMessage, isForbidden, isNotFound } from "@/ux/lib/api-state";
import { ux } from "@/ux/lib/paths";

export function UxRunDetailPage() {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const config = useImporterConfig(id ?? null);
  const run = useImporterRun(id ?? null, runId ?? null);
  const errors = useImportRunErrors(id ?? null, runId ?? null);
  const changes = useRunChanges(id ?? "", runId ?? "");
  const credentials = useCredentials();

  if (config.isPending || run.isPending) {
    return (
      <PageContainer>
        <Card className="py-0">
          <TableSkeleton rows={6} columns={4} />
        </Card>
      </PageContainer>
    );
  }

  const err = config.error ?? run.error ?? errors.error ?? changes.error;
  if (err || !config.data || !run.data) {
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
            title="Run not found"
            description="This importer or run does not exist."
            backHref={ux("/importers")}
            backLabel="All importers"
          />
        </PageContainer>
      );
    }
    return (
      <PageContainer>
        <ErrorState description={errorMessage(err)} onRetry={() => void run.refetch()} />
      </PageContainer>
    );
  }

  const apiRun = run.data.run;
  const credential = apiRun.credentialIds?.length
    ? (credentials.data?.credentials.find((c) => c.id === apiRun.credentialIds?.[0]) ?? null)
    : null;

  return (
    <RunDetail
      importer={mapImporterConfig(config.data.config, credentials.data?.credentials ?? [])}
      run={mapImportRun(apiRun)}
      errors={(errors.data?.errors ?? []).map(mapRunError)}
      changes={(changes.data?.changes ?? []).map(mapRunChange)}
      credential={credential ? { id: credential.id, label: credential.label } : null}
    />
  );
}
