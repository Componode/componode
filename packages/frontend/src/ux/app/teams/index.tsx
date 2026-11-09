import { toast } from "sonner";
import { TEAM_SORT_KEYS, useCreateTeam, useLobs, useTeamsList, type TeamSortKey } from "@/api/hooks/org";
import { OrgFormDialog } from "@/ux/components/org/org-form-dialog";
import { TeamsTable } from "@/ux/components/org/org-tables";
import { ListPagination } from "@/ux/components/patterns/list-pagination";
import { ListToolbar } from "@/ux/components/patterns/list-toolbar";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { ErrorState, TableSkeleton } from "@/ux/components/patterns/states";
import { Card } from "@/ux/components/ui/card";
import { useClampPage } from "@/ux/hooks/use-clamp-page";
import { useListState } from "@/ux/hooks/use-list-state";
import { useListSearch } from "@/ux/hooks/use-list-search";
import { errorMessage } from "@/ux/lib/api-state";

export function UxTeamsPage() {
  // Server-paginated list state lives in the URL (spec 068 / ADR-130).
  const list = useListState<TeamSortKey>({
    sortKeys: TEAM_SORT_KEYS,
    defaultSort: "name",
    defaultOrder: "asc",
  });
  const [query, setQuery] = useListSearch(list);
  const teams = useTeamsList(list);
  useClampPage(list, teams.data?.pagination);
  const createTeam = useCreateTeam();
  // The create dialog's LOB picker needs the full set — fetch-all (exempt).
  const lobs = useLobs();

  const rows = teams.data?.data ?? [];
  const pagination = teams.data?.pagination;

  return (
    <PageContainer>
      <PageHeader
        title="Teams"
        description="The people accountable for products and components. Ownership drives notifications and incident routing."
        actions={
          <OrgFormDialog
            noun="team"
            lobs={lobs.data?.lobs ?? []}
            pending={createTeam.isPending}
            onSubmit={({ name, slug, description, lobId }) =>
              createTeam.mutate(
                { name, slug, description, lobId },
                {
                  onSuccess: () => toast.success(`Team ${name} created`),
                  onError: (e) => toast.error(e.message),
                },
              )
            }
          />
        }
      />
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search teams"
        resultCount={rows.length}
        total={pagination?.total ?? 0}
      />
      {teams.isPending ? (
        <Card className="py-0">
          <TableSkeleton rows={5} columns={5} />
        </Card>
      ) : teams.error ? (
        <ErrorState description={errorMessage(teams.error)} onRetry={() => void teams.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          <TeamsTable
            data={rows}
            sort={list.sort}
            order={list.order}
            onSortChange={(sort, order) => list.setSort(sort as TeamSortKey | null, order)}
          />
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
        </div>
      )}
    </PageContainer>
  );
}
