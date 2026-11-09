import { LayersIcon } from "lucide-react";
import { Link } from "react-router-dom";
import {
  COMPONENT_GROUPS_SORT_KEYS,
  componentGroupsListParams,
  useComponentGroups,
  type ComponentGroupsFilterKey,
  type ComponentGroupsSortKey,
} from "@/api/hooks/component-groups";
import { useSession } from "@/api/hooks/auth";
import { mapComponentGroup } from "@/api/mappers/catalog";
import { ComponentGroupCreateDialog } from "@/ux/components/catalog/component-group-create-dialog";
import { ListPagination } from "@/ux/components/patterns/list-pagination";
import { ListSortSelect, type ListSortOption } from "@/ux/components/patterns/list-sort-select";
import { ListToolbar } from "@/ux/components/patterns/list-toolbar";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { EmptyState, ErrorState } from "@/ux/components/patterns/states";
import { LifecycleBadge } from "@/ux/components/patterns/status-badge";
import { TitleWithSummary } from "@/ux/components/patterns/title-with-summary";
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/ux/components/ui/card";
import { Skeleton } from "@/ux/components/ui/skeleton";
import { useClampPage } from "@/ux/hooks/use-clamp-page";
import { useListState, type ListFilterConfig } from "@/ux/hooks/use-list-state";
import { useListSearch } from "@/ux/hooks/use-list-search";
import { LIFECYCLE_META } from "@/ux/lib/domain";
import { errorMessage } from "@/ux/lib/api-state";
import { canAccess } from "@/ux/lib/nav";
import { ux } from "@/ux/lib/paths";

/** Card grids have no header row — sort is a (sort, order) option list. */
const GROUP_SORT_OPTIONS: ListSortOption<ComponentGroupsSortKey>[] = [
  { sort: "name", order: "asc", label: "Name" },
  { sort: "name", order: "desc", label: "Name (Z–A)" },
  { sort: "lifecycle", order: "asc", label: "Lifecycle" },
  { sort: "createdAt", order: "desc", label: "Newest first" },
  { sort: "createdAt", order: "asc", label: "Oldest first" },
];

const GROUP_FILTERS: { [K in ComponentGroupsFilterKey]: ListFilterConfig } = {
  // Default ACTIVE: retired groups stay hidden unless asked (unchanged
  // pre-068 behavior); "all" admits RETIRED rows via includeRetired.
  lifecycle: { default: "ACTIVE", values: ["all", "ACTIVE", "RETIRED"] },
};

export function UxComponentGroupsPage() {
  // Server-paginated list state lives in the URL (spec 068 / ADR-130).
  const list = useListState<ComponentGroupsSortKey, ComponentGroupsFilterKey>({
    sortKeys: COMPONENT_GROUPS_SORT_KEYS,
    defaultSort: "name",
    defaultOrder: "asc",
    filters: GROUP_FILTERS,
  });
  const [query, setQuery] = useListSearch(list);
  const { data, isPending, error, refetch } = useComponentGroups(componentGroupsListParams(list));
  useClampPage(list, data?.pagination);
  const session = useSession();
  // componentGroup:create is EDITOR+ — hidden for viewers.
  const canCreate = canAccess(session.data?.role ?? "VIEWER", "EDITOR");

  const rows = (data?.data ?? []).map(mapComponentGroup);
  const pagination = data?.pagination;

  return (
    <PageContainer>
      <PageHeader
        title="Component groups"
        description="Logical bundles of components that ship and retire together — useful when a product composes dozens of services."
        actions={canCreate ? <ComponentGroupCreateDialog /> : undefined}
      />
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search component groups"
        resultCount={rows.length}
        total={pagination?.total ?? 0}
        filters={[
          {
            id: "lifecycle",
            label: "Lifecycle",
            value: list.filters.lifecycle,
            onChange: (v) => list.setFilter("lifecycle", v),
            // The unset sentinel is ACTIVE (retired hidden by default), so
            // Clear restores ACTIVE — "All" is an explicit option, not the
            // injected sentinel.
            emptyValue: "ACTIVE",
            options: [
              { value: "all", label: "All" },
              ...Object.entries(LIFECYCLE_META).map(([value, m]) => ({ value, label: m.label })),
            ],
          },
        ]}
        end={
          <ListSortSelect
            sort={list.sort}
            order={list.order}
            onSortChange={(sort, order) => list.setSort(sort, order)}
            options={GROUP_SORT_OPTIONS}
          />
        }
      />
      {isPending ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </ul>
      ) : error ? (
        <ErrorState
          title="Component groups unavailable"
          description={errorMessage(error)}
          onRetry={() => void refetch()}
        />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={LayersIcon}
          title="No component groups"
          description="No groups match — retired groups can be shown with the lifecycle filter."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((g) => (
              <li key={g.id}>
                <Card className="relative h-full transition-colors hover:border-primary/40">
                  <CardHeader>
                    <span className="mb-2 flex size-9 items-center justify-center rounded-md bg-accent text-accent-foreground">
                      <LayersIcon className="size-4" aria-hidden="true" />
                    </span>
                    <CardTitle>
                      <TitleWithSummary
                        title={
                          <Link to={ux(`/component-groups/${g.slug}`)} className="after:absolute after:inset-0 hover:underline">
                            {g.name}
                          </Link>
                        }
                        titleText={g.name}
                        summary={{ kind: "componentGroup", row: g }}
                      />
                    </CardTitle>
                    <CardDescription>{g.team ?? "No owning team"}</CardDescription>
                    <CardAction>
                      <LifecycleBadge value={g.lifecycle} />
                    </CardAction>
                  </CardHeader>
                  <CardFooter className="mt-auto justify-between text-sm text-muted-foreground">
                    <span className="tabular">{g.members} components</span>
                    <code className="font-mono text-xs">{g.slug}</code>
                  </CardFooter>
                </Card>
              </li>
            ))}
          </ul>
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
