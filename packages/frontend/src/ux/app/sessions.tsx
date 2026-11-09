import { SessionsTable } from "@/ux/components/admin/sessions-table";
import { useSession } from "@/ux/components/app/session-context";
import { ListPagination } from "@/ux/components/patterns/list-pagination";
import { ListToolbar } from "@/ux/components/patterns/list-toolbar";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { ErrorState, TableSkeleton } from "@/ux/components/patterns/states";
import { Card } from "@/ux/components/ui/card";
import { SESSION_SORT_KEYS, useSessionsList, type SessionSortKey } from "@/api/hooks/sessions";
import { mapSession } from "@/api/mappers/operations";
import { useClampPage } from "@/ux/hooks/use-clamp-page";
import { useListState } from "@/ux/hooks/use-list-state";
import { useListSearch } from "@/ux/hooks/use-list-search";
import { errorMessage } from "@/ux/lib/api-state";

/** Lists the caller's own sessions (GET /sessions is self-scoped). */
export function UxSessionsPage() {
  const { user } = useSession();
  // Server-paginated list state lives in the URL (spec 068 / ADR-130).
  // Backend defaults (listSessionsQuerySchema): createdAt desc.
  const list = useListState<SessionSortKey>({
    sortKeys: SESSION_SORT_KEYS,
    defaultSort: "createdAt",
    defaultOrder: "desc",
  });
  const [query, setQuery] = useListSearch(list);
  const sessions = useSessionsList(list);
  useClampPage(list, sessions.data?.pagination);

  const rows = sessions.data?.data ?? [];
  const pagination = sessions.data?.pagination;
  const owner = { username: user.username, displayName: user.displayName ?? user.username };

  return (
    <PageContainer>
      <PageHeader
        title="Sessions"
        description="Your active sign-ins. Revoke a session to sign that device out immediately."
      />
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search devices"
        resultCount={rows.length}
        total={pagination?.total ?? 0}
      />
      {sessions.isPending ? (
        <Card className="py-0">
          <TableSkeleton rows={4} columns={5} />
        </Card>
      ) : sessions.error ? (
        <ErrorState description={errorMessage(sessions.error)} onRetry={() => void sessions.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          <SessionsTable
            showOwner={false}
            data={rows.map((s) => mapSession(s, owner))}
            sort={list.sort}
            order={list.order}
            onSortChange={(sort, order) => list.setSort(sort as SessionSortKey | null, order)}
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
