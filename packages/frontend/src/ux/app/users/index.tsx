import { InviteUserDialog } from "@/ux/components/admin/invite-user-dialog";
import { UsersTable } from "@/ux/components/admin/users-table";
import { useSession } from "@/ux/components/app/session-context";
import { ListPagination } from "@/ux/components/patterns/list-pagination";
import { ListToolbar } from "@/ux/components/patterns/list-toolbar";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { ErrorState, TableSkeleton } from "@/ux/components/patterns/states";
import { Card } from "@/ux/components/ui/card";
import {
  USER_SORT_KEYS,
  useUsersList,
  type UserFilterKey,
  type UserSortKey,
} from "@/api/hooks/users";
import { mapUser } from "@/api/mappers/operations";
import { useClampPage } from "@/ux/hooks/use-clamp-page";
import { useListState, type ListFilterConfig } from "@/ux/hooks/use-list-state";
import { useListSearch } from "@/ux/hooks/use-list-search";
import { ROLE_META, type Role } from "@/ux/lib/domain";
import { errorMessage } from "@/ux/lib/api-state";

/**
 * URL filter contract for GET /users: `role` and `isActive` pass through to
 * the API verbatim (role enum; isActive coerces "true"/"false" via the
 * backend's optionalBooleanParam). "all" is the unset sentinel — omitted
 * from the query string by `buildListQueryString`.
 */
const USER_FILTERS: { [K in UserFilterKey]: ListFilterConfig } = {
  role: { default: "all", values: ["all", ...Object.keys(ROLE_META)] },
  isActive: { default: "all", values: ["all", "true", "false"] },
};

export function UxUsersPage() {
  const { user } = useSession();
  // Server-paginated list state lives in the URL (spec 068 / ADR-130).
  // Backend defaults (listUsersQuerySchema): createdAt desc.
  const list = useListState<UserSortKey, UserFilterKey>({
    sortKeys: USER_SORT_KEYS,
    defaultSort: "createdAt",
    defaultOrder: "desc",
    filters: USER_FILTERS,
  });
  const [query, setQuery] = useListSearch(list);
  const users = useUsersList(list);
  useClampPage(list, users.data?.pagination);

  const rows = users.data?.data ?? [];
  const pagination = users.data?.pagination;

  return (
    <PageContainer>
      <PageHeader
        title="Users"
        description="Workspace accounts and their roles. Roles gate what people can change."
        actions={<InviteUserDialog />}
      />
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search name or email"
        resultCount={rows.length}
        total={pagination?.total ?? 0}
        filters={[
          {
            id: "role",
            label: "Role",
            value: list.filters.role,
            onChange: (v) => list.setFilter("role", v),
            options: (Object.keys(ROLE_META) as Role[]).map((r) => ({
              value: r,
              label: ROLE_META[r].label,
            })),
          },
          {
            id: "isActive",
            label: "Status",
            value: list.filters.isActive,
            onChange: (v) => list.setFilter("isActive", v),
            options: [
              { value: "true", label: "Active" },
              { value: "false", label: "Deactivated" },
            ],
          },
        ]}
      />
      {users.isPending ? (
        <Card className="py-0">
          <TableSkeleton rows={5} columns={4} />
        </Card>
      ) : users.error ? (
        <ErrorState description={errorMessage(users.error)} onRetry={() => void users.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          <UsersTable
            data={rows.map(mapUser)}
            selfId={user.id}
            sort={list.sort}
            order={list.order}
            onSortChange={(sort, order) => list.setSort(sort as UserSortKey | null, order)}
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
