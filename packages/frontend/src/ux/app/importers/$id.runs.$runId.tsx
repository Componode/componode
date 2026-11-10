import { useState } from "react";
import { useParams } from "react-router-dom";
import { facetValue } from "@/api/list-query";
import { useRunChanges, type RunChangesSortKey } from "@/api/hooks/audit";
import { useCredentials } from "@/api/hooks/credentials";
import {
  useImporterConfig,
  useImporterRun,
  useImportRunErrors,
  type RunErrorsSortKey,
} from "@/api/hooks/importers";
import { useUsers } from "@/api/hooks/users";
import { mapImporterConfig, mapImportRun, mapRunChange, mapRunError } from "@/api/mappers/operations";
import { useCrumbLabel } from "@/ux/components/app/app-header";
import {
  RunDetail,
  type RunChangesControls,
  type RunErrorsControls,
} from "@/ux/components/importers/run-detail";
import { PageContainer } from "@/ux/components/patterns/page-header";
import { ErrorState, ForbiddenState, NotFoundState, TableSkeleton } from "@/ux/components/patterns/states";
import { Card } from "@/ux/components/ui/card";
import { useSubListState } from "@/ux/hooks/use-sub-list-state";
import { errorMessage, isForbidden, isNotFound } from "@/ux/lib/api-state";
import { ux } from "@/ux/lib/paths";

export function UxRunDetailPage() {
  const { id, runId } = useParams<{ id: string; runId: string }>();
  const config = useImporterConfig(id ?? null);
  const run = useImporterRun(id ?? null, runId ?? null);
  const credentials = useCredentials();
  const users = useUsers();

  const errorsList = useSubListState<RunErrorsSortKey>("createdAt");
  const [errorType, setErrorType] = useState("");
  const changesList = useSubListState<RunChangesSortKey>("createdAt");
  const [action, setAction] = useState("all");

  const runActive =
    run.data?.run.status === "PENDING" || run.data?.run.status === "RUNNING";
  // Poll the sub-lists while the run is live so errors/changes stream in.
  const poll = runActive ? 3000 : false;

  const errors = useImportRunErrors(id ?? null, runId ?? null, {
    page: errorsList.page,
    pageSize: errorsList.pageSize,
    sort: errorsList.sort ?? undefined,
    order: errorsList.order,
    errorType: facetValue(errorType),
  }, { refetchInterval: poll });
  const changes = useRunChanges(id ?? "", runId ?? "", {
    page: changesList.page,
    pageSize: changesList.pageSize,
    sort: changesList.sort ?? undefined,
    order: changesList.order,
    action: facetValue(action),
  }, { refetchInterval: poll });
  useCrumbLabel(id, config.data?.config?.label ?? null);

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

  const errorsControls: RunErrorsControls = {
    page: errorsList.page,
    pageSize: errorsList.pageSize,
    sort: errorsList.sort,
    order: errorsList.order,
    onSortChange: (s, o) => errorsList.setSort(s as RunErrorsSortKey | null, o),
    total: errors.data?.pagination.total ?? 0,
    pageCount: errors.data?.pagination.pageCount ?? 0,
    errorType,
    onErrorTypeChange: (v) => {
      setErrorType(v);
      errorsList.resetPage();
    },
    onOrderChange: errorsList.setOrder,
    onPageChange: errorsList.setPage,
    onPageSizeChange: errorsList.setPageSize,
  };
  const changesControls: RunChangesControls = {
    page: changesList.page,
    pageSize: changesList.pageSize,
    sort: changesList.sort,
    order: changesList.order,
    onSortChange: (s, o) => changesList.setSort(s as RunChangesSortKey | null, o),
    total: changes.data?.pagination.total ?? 0,
    pageCount: changes.data?.pagination.pageCount ?? 0,
    action,
    onActionChange: (v) => {
      setAction(v);
      changesList.resetPage();
    },
    onOrderChange: changesList.setOrder,
    onPageChange: changesList.setPage,
    onPageSizeChange: changesList.setPageSize,
  };

  return (
    <RunDetail
      importer={mapImporterConfig(config.data.config, credentials.data?.credentials ?? [])}
      run={mapImportRun(
        apiRun,
        new Map((users.data?.users ?? []).map((u) => [u.id, u.displayName ?? u.username])),
      )}
      errors={(errors.data?.data ?? []).map(mapRunError)}
      changes={(changes.data?.data ?? []).map(mapRunChange)}
      errorsList={errorsControls}
      changesList={changesControls}
      credential={credential ? { id: credential.id, label: credential.label } : null}
    />
  );
}
