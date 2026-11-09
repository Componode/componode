import { useParams } from "react-router-dom";
import { useCredentials } from "@/api/hooks/credentials";
import {
  IMPORTER_RUNS_SORT_KEYS,
  importerRunsListParams,
  useImporterConfig,
  useImporterRuns,
  type ImporterRunsFilterKey,
  type ImporterRunsSortKey,
} from "@/api/hooks/importers";
import { useUsers } from "@/api/hooks/users";
import { mapImporterConfig, mapImportRun } from "@/api/mappers/operations";
import { useLeafCrumb } from "@/ux/components/app/app-header";
import { ImporterDetail } from "@/ux/components/importers/importer-detail";
import { PageContainer } from "@/ux/components/patterns/page-header";
import { ErrorState, ForbiddenState, NotFoundState, TableSkeleton } from "@/ux/components/patterns/states";
import { Card } from "@/ux/components/ui/card";
import { useClampPage } from "@/ux/hooks/use-clamp-page";
import { useListState, type ListFilterConfig } from "@/ux/hooks/use-list-state";
import { RUN_STATUS_META, type RunStatus } from "@/ux/lib/domain";
import { errorMessage, isForbidden, isNotFound } from "@/ux/lib/api-state";
import { ux } from "@/ux/lib/paths";

const RUNS_FILTERS: { [K in ImporterRunsFilterKey]: ListFilterConfig } = {
  status: {
    default: "all",
    values: ["all", ...(Object.keys(RUN_STATUS_META) as RunStatus[])],
  },
};

export function UxImporterDetailPage() {
  const { id } = useParams<{ id: string }>();
  const config = useImporterConfig(id ?? null);
  // Server-paginated run history — state lives in the URL (spec 068).
  const list = useListState<ImporterRunsSortKey, ImporterRunsFilterKey>({
    sortKeys: IMPORTER_RUNS_SORT_KEYS,
    defaultSort: "createdAt",
    defaultOrder: "desc",
    filters: RUNS_FILTERS,
  });
  const runs = useImporterRuns(id ?? null, importerRunsListParams(list));
  useClampPage(list, runs.data?.pagination);
  // The "last run failed" alert must reflect the newest run regardless of
  // the history table's page/sort/filter (spec 068 review T063) — a
  // dedicated single-row query on the list default (createdAt desc).
  const latestRun = useImporterRuns(id ?? null, {
    page: 1,
    pageSize: 1,
    sort: "createdAt",
    order: "desc",
  });
  const credentials = useCredentials();
  const users = useUsers();
  useLeafCrumb(config.data?.config?.label ?? null);

  if (config.isPending || runs.isPending) {
    return (
      <PageContainer>
        <Card className="py-0">
          <TableSkeleton rows={6} columns={4} />
        </Card>
      </PageContainer>
    );
  }

  const err = config.error ?? runs.error ?? latestRun.error ?? credentials.error;
  if (err || !config.data) {
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
            title="Importer not found"
            description="This importer configuration does not exist."
            backHref={ux("/importers")}
            backLabel="All importers"
          />
        </PageContainer>
      );
    }
    return (
      <PageContainer>
        <ErrorState description={errorMessage(err)} onRetry={() => void config.refetch()} />
      </PageContainer>
    );
  }

  const userNames = new Map(
    (users.data?.users ?? []).map((u) => [u.id, u.displayName ?? u.username]),
  );
  return (
    <ImporterDetail
      importer={mapImporterConfig(config.data.config, credentials.data?.credentials ?? [])}
      runs={(runs.data?.data ?? []).map((r) => mapImportRun(r, userNames))}
      lastRun={
        latestRun.data?.data[0] ? mapImportRun(latestRun.data.data[0], userNames) : null
      }
      runsList={list}
      runsPagination={runs.data?.pagination}
    />
  );
}
