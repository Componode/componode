import { Link } from "react-router-dom";
import { ContainerIcon, PlusIcon } from "lucide-react";
import { useSession } from "@/api/hooks/auth";
import { useCredentials } from "@/api/hooks/credentials";
import {
  IMPORTER_CONFIGS_SORT_KEYS,
  importerConfigsListParams,
  useImporterConfigs,
  type ImporterConfigsFilterKey,
  type ImporterConfigsSortKey,
} from "@/api/hooks/importers";
import { useDashboardSummary } from "@/api/hooks/dashboard";
import { importerProvider, mapImporterConfig } from "@/api/mappers/operations";
import { ImporterCard } from "@/ux/components/importers/importer-card";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { ListPagination } from "@/ux/components/patterns/list-pagination";
import { ListSortSelect, type ListSortOption } from "@/ux/components/patterns/list-sort-select";
import { ListToolbar } from "@/ux/components/patterns/list-toolbar";
import { EmptyState, ErrorState, TableSkeleton } from "@/ux/components/patterns/states";
import { CableIcon, SearchXIcon } from "lucide-react";
import { Button } from "@/ux/components/ui/button";
import { Card } from "@/ux/components/ui/card";
import { useClampPage } from "@/ux/hooks/use-clamp-page";
import { useListState, type ListFilterConfig } from "@/ux/hooks/use-list-state";
import { useListSearch } from "@/ux/hooks/use-list-search";
import { IMPORTER_NAMES, PROVIDER_META } from "@/ux/lib/domain";
import { errorMessage } from "@/ux/lib/api-state";
import { ux } from "@/ux/lib/paths";

const IMPORTER_CONFIGS_FILTERS: { [K in ImporterConfigsFilterKey]: ListFilterConfig } = {
  enabled: { default: "all", values: ["all", "true", "false"] },
  importerName: { default: "all", values: ["all", ...IMPORTER_NAMES] },
};

const IMPORTER_OPTIONS = IMPORTER_NAMES.map((name) => ({
  value: name,
  label: PROVIDER_META[importerProvider(name)]?.label ?? name,
}));

/** Card grids have no header row — sort is a (sort, order) option list. */
const IMPORTER_SORT_OPTIONS: ListSortOption<ImporterConfigsSortKey>[] = [
  { sort: "name", order: "asc", label: "Name" },
  { sort: "name", order: "desc", label: "Name (Z–A)" },
  { sort: "createdAt", order: "desc", label: "Newest first" },
  { sort: "createdAt", order: "asc", label: "Oldest first" },
  { sort: "updatedAt", order: "desc", label: "Recently updated" },
  { sort: "importerName", order: "asc", label: "Importer (A–Z)" },
  { sort: "enabled", order: "desc", label: "Enabled first" },
  { sort: "enabled", order: "asc", label: "Paused first" },
];

export function UxImportersPage() {
  // Server-paginated list state lives in the URL (spec 068 / ADR-130).
  const list = useListState<ImporterConfigsSortKey, ImporterConfigsFilterKey>({
    sortKeys: IMPORTER_CONFIGS_SORT_KEYS,
    defaultSort: "createdAt",
    defaultOrder: "desc",
    filters: IMPORTER_CONFIGS_FILTERS,
  });
  const [query, setQuery] = useListSearch(list);
  const configs = useImporterConfigs(importerConfigsListParams(list));
  useClampPage(list, configs.data?.pagination);
  const credentials = useCredentials();
  const summary = useDashboardSummary();
  const session = useSession();
  const isAdmin = session.data?.role === "ADMIN";

  if (configs.isPending || credentials.isPending) {
    return (
      <PageContainer>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <Card className="py-0">
            <TableSkeleton rows={3} columns={2} />
          </Card>
        </div>
      </PageContainer>
    );
  }
  const err = configs.error ?? credentials.error;
  if (err) {
    return (
      <PageContainer>
        <ErrorState description={errorMessage(err)} onRetry={() => void configs.refetch()} />
      </PageContainer>
    );
  }

  const lastRunByConfig = new Map((summary.data?.lastRuns ?? []).map((r) => [r.configId, r]));
  const items = (configs.data?.data ?? []).map((c) =>
    mapImporterConfig(c, credentials.data?.credentials ?? [], lastRunByConfig.get(c.id)),
  );
  const pagination = configs.data?.pagination;
  const unfiltered =
    !list.search && list.filters.enabled === "all" && list.filters.importerName === "all" && list.page === 1;

  return (
    <PageContainer>
      <PageHeader
        title="Importers"
        description="Scheduled connections that discover components and instances from your cloud providers and tools."
        actions={
          <div className="flex items-center gap-2">
            {isAdmin && (
              <Button asChild variant="outline">
                <Link to={ux("/importers/new/docker")}>
                  <ContainerIcon data-icon="inline-start" />
                  Guided Docker setup
                </Link>
              </Button>
            )}
            <Button asChild>
              <Link to={ux("/importers/new")}>
                <PlusIcon data-icon="inline-start" />
                Add importer
              </Link>
            </Button>
          </div>
        }
      />
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search importer label"
        resultCount={items.length}
        total={pagination?.total ?? 0}
        filters={[
          {
            id: "enabled",
            label: "Status",
            value: list.filters.enabled,
            onChange: (v) => list.setFilter("enabled", v),
            options: [
              { value: "true", label: "Enabled" },
              { value: "false", label: "Paused" },
            ],
          },
          {
            id: "importerName",
            label: "Importer",
            value: list.filters.importerName,
            onChange: (v) => list.setFilter("importerName", v),
            options: IMPORTER_OPTIONS,
          },
        ]}
        end={
          <ListSortSelect
            sort={list.sort}
            order={list.order}
            onSortChange={(sort, order) => list.setSort(sort, order)}
            options={IMPORTER_SORT_OPTIONS}
          />
        }
      />
      {items.length === 0 ? (
        <Card className="py-0">
          {unfiltered ? (
            <EmptyState
              icon={CableIcon}
              title="No importers configured"
              description="Add an importer to start discovering components on a schedule."
            />
          ) : (
            <EmptyState
              icon={SearchXIcon}
              title="No importers match"
              description="Try a different search or clear the filters."
            />
          )}
        </Card>
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((i) => (
            <li key={i.id}>
              <ImporterCard importer={i} />
            </li>
          ))}
        </ul>
      )}
      {pagination && pagination.total > 0 && (
        <ListPagination
          page={list.page}
          pageSize={list.pageSize}
          total={pagination.total}
          pageCount={pagination.pageCount}
          onPageChange={list.setPage}
          onPageSizeChange={list.setPageSize}
        />
      )}
    </PageContainer>
  );
}
