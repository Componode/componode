import { toast } from "sonner";
import { LOB_SORT_KEYS, useCreateLob, useLobsList, type LobSortKey } from "@/api/hooks/org";
import { OrgFormDialog } from "@/ux/components/org/org-form-dialog";
import { LobsGrid } from "@/ux/components/org/org-tables";
import { ListPagination } from "@/ux/components/patterns/list-pagination";
import { ListSortSelect, type ListSortOption } from "@/ux/components/patterns/list-sort-select";
import { ListToolbar } from "@/ux/components/patterns/list-toolbar";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { ErrorState, TableSkeleton } from "@/ux/components/patterns/states";
import { Card } from "@/ux/components/ui/card";
import { useClampPage } from "@/ux/hooks/use-clamp-page";
import { useListState } from "@/ux/hooks/use-list-state";
import { useListSearch } from "@/ux/hooks/use-list-search";
import { errorMessage } from "@/ux/lib/api-state";

/** Card grids have no header row — sort is a (sort, order) option list. */
const LOB_SORT_OPTIONS: ListSortOption<LobSortKey>[] = [
  { sort: "name", order: "asc", label: "Name" },
  { sort: "name", order: "desc", label: "Name (Z–A)" },
  { sort: "createdAt", order: "desc", label: "Newest first" },
  { sort: "createdAt", order: "asc", label: "Oldest first" },
  // FR-005: the card's count figures are SQL-sortable — desc reads
  // "most", asc reads "fewest".
  { sort: "productCount", order: "desc", label: "Most products" },
  { sort: "productCount", order: "asc", label: "Fewest products" },
  { sort: "teamCount", order: "desc", label: "Most teams" },
  { sort: "teamCount", order: "asc", label: "Fewest teams" },
];

export function UxLobsPage() {
  // Server-paginated list state lives in the URL (spec 068 / ADR-130).
  const list = useListState<LobSortKey>({
    sortKeys: LOB_SORT_KEYS,
    defaultSort: "name",
    defaultOrder: "asc",
  });
  const [query, setQuery] = useListSearch(list);
  const lobs = useLobsList(list);
  useClampPage(list, lobs.data?.pagination);
  const createLob = useCreateLob();

  const rows = lobs.data?.data ?? [];
  const pagination = lobs.data?.pagination;

  return (
    <PageContainer>
      <PageHeader
        title="Lines of business"
        description="The top of the ownership tree. Every product rolls up to exactly one line of business."
        actions={
          <OrgFormDialog
            noun="line of business"
            pending={createLob.isPending}
            onSubmit={({ name, slug, description }) =>
              createLob.mutate(
                { name, slug, description },
                {
                  onSuccess: () => toast.success(`Line of business ${name} created`),
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
        placeholder="Search lines of business"
        resultCount={rows.length}
        total={pagination?.total ?? 0}
        end={
          <ListSortSelect
            sort={list.sort}
            order={list.order}
            onSortChange={(sort, order) => list.setSort(sort, order)}
            options={LOB_SORT_OPTIONS}
          />
        }
      />
      {lobs.isPending ? (
        <Card className="py-0">
          <TableSkeleton rows={5} columns={4} />
        </Card>
      ) : lobs.error ? (
        <ErrorState description={errorMessage(lobs.error)} onRetry={() => void lobs.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          <LobsGrid data={rows} />
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
