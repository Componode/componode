import { Link } from "react-router-dom";
import { PlusIcon, SearchXIcon } from "lucide-react";
import {
  DOCKER_TARGETS_SORT_KEYS,
  dockerTargetsListParams,
  useDockerTargets,
  type DockerTargetsSortKey,
} from "@/api/hooks/docker-targets";
import type { SummaryField } from "@/ux/components/patterns/title-with-summary";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { ListPagination } from "@/ux/components/patterns/list-pagination";
import { ListToolbar } from "@/ux/components/patterns/list-toolbar";
import { RelativeTime } from "@/ux/components/patterns/primitives";
import { SortableTableHead } from "@/ux/components/patterns/sortable-header";
import { StatusBadge } from "@/ux/components/patterns/status-badge";
import { TitleWithSummary } from "@/ux/components/patterns/title-with-summary";
import { ErrorState, TableSkeleton } from "@/ux/components/patterns/states";
import { Button } from "@/ux/components/ui/button";
import { Card } from "@/ux/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table";
import { useClampPage } from "@/ux/hooks/use-clamp-page";
import { useListState } from "@/ux/hooks/use-list-state";
import { useListSearch } from "@/ux/hooks/use-list-search";
import { errorMessage } from "@/ux/lib/api-state";
import { ux } from "@/ux/lib/paths";
import type { DockerTarget } from "@/api/types";

/** Curated hover-summary fields for a docker target (spec 068 US4). */
function dockerTargetSummary(t: DockerTarget): SummaryField[] {
  return [
    {
      label: "Target ID",
      value: <code className="font-mono text-xs break-all">{t.targetId}</code>,
      wide: true,
    },
    { label: "Transport", value: String(t.profile.transport ?? "—") },
    {
      label: "Status",
      value: <StatusBadge tone={t.enabled ? "success" : "warning"} label={t.enabled ? "Enabled" : "Disabled"} />,
    },
    { label: "Created", value: <RelativeTime iso={t.createdAt} /> },
  ];
}

export function UxDockerTargetsPage() {
  // Server-paginated list state lives in the URL (spec 068 / ADR-130).
  const list = useListState<DockerTargetsSortKey>({
    sortKeys: DOCKER_TARGETS_SORT_KEYS,
    defaultSort: "name",
    defaultOrder: "asc",
  });
  const [query, setQuery] = useListSearch(list);
  const targets = useDockerTargets(dockerTargetsListParams(list));
  useClampPage(list, targets.data?.pagination);

  const rows = targets.data?.data ?? [];
  const pagination = targets.data?.pagination;

  const sortProps = {
    sort: list.sort,
    order: list.order,
    onSortChange: (sort: string | null, order: "asc" | "desc") =>
      list.setSort((sort as DockerTargetsSortKey | null) ?? null, order),
  };

  return (
    <PageContainer>
      <PageHeader
        title="Docker targets"
        description="Hub-managed Docker Engine access routes. Profiles hold no secret values — transports reference credential keys."
        actions={
          <Button asChild>
            <Link to={ux("/docker-targets/new")}>
              <PlusIcon data-icon="inline-start" />
              New target
            </Link>
          </Button>
        }
      />
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search label or target ID"
        resultCount={rows.length}
        total={pagination?.total ?? 0}
      />
      {targets.isPending ? (
        <Card className="py-0"><TableSkeleton rows={5} columns={5} /></Card>
      ) : targets.error ? (
        <ErrorState description={errorMessage(targets.error)} onRetry={() => void targets.refetch()} />
      ) : rows.length === 0 ? (
        <Card className="py-0">
          <Table>
            <TableBody>
              <TableRow>
                <TableCell colSpan={5} className="py-10">
                  <p className="flex flex-col items-center gap-1 text-center text-sm text-muted-foreground">
                    <SearchXIcon className="size-5" aria-hidden="true" />
                    {query || list.sort !== "name" || list.order !== "asc" || list.page > 1
                      ? "No Docker targets match. Try a different search or clear the filters."
                      : "No Docker targets yet. Create one to run the Docker importer on the Hub."}
                  </p>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </Card>
      ) : (
        <Card className="overflow-hidden py-0">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <SortableTableHead sortKey="name" {...sortProps} className="pl-4">Label</SortableTableHead>
                <SortableTableHead sortKey="targetId" {...sortProps}>Target ID</SortableTableHead>
                <TableHead>Transport</TableHead>
                <SortableTableHead sortKey="enabled" {...sortProps}>Status</SortableTableHead>
                <TableHead className="pr-4" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="max-w-64 pl-4 font-medium">
                    <TitleWithSummary
                      className="min-w-0"
                      title={
                        <Link to={ux(`/docker-targets/${t.id}`)} className="block truncate hover:underline">
                          {t.label}
                        </Link>
                      }
                      titleText={t.label}
                      summary={dockerTargetSummary(t)}
                    />
                  </TableCell>
                  <TableCell className="font-mono text-xs">{t.targetId}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{String(t.profile.transport)}</TableCell>
                  <TableCell><StatusBadge tone={t.enabled ? "success" : "warning"} label={t.enabled ? "Enabled" : "Disabled"} /></TableCell>
                  <TableCell className="pr-4 text-right">
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={ux(`/docker-targets/${t.id}`)}>Manage</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
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
