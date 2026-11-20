import { Fragment, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon, PackageSearchIcon } from "lucide-react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import {
  PACKAGES_FILTER_KEYS,
  PACKAGES_SORT_KEYS,
  packagesListParams,
  usePackages,
  type PackagesFilterKey,
  type PackagesSortKey,
} from "@/api/hooks/packages";
import { ListPagination } from "@/ux/components/patterns/list-pagination";
import { ListSortSelect, type ListSortOption } from "@/ux/components/patterns/list-sort-select";
import { ListToolbar, type FilterDef } from "@/ux/components/patterns/list-toolbar";
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header";
import { EmptyState, ErrorState } from "@/ux/components/patterns/states";
import { MonoValue } from "@/ux/components/patterns/primitives";
import { Badge } from "@/ux/components/ui/badge";
import { Button } from "@/ux/components/ui/button";
import { Skeleton } from "@/ux/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ux/components/ui/table";
import { useClampPage } from "@/ux/hooks/use-clamp-page";
import { useListState, type ListFilterConfig } from "@/ux/hooks/use-list-state";
import { useListSearch } from "@/ux/hooks/use-list-search";
import { useSession } from "@/api/hooks/auth";
import { toPackageView } from "@/api/mappers/packages";
import { canAccess } from "@/ux/lib/nav";
import { errorMessage } from "@/ux/lib/api-state";
import { flags } from "@/ux/lib/flags";
import { ux } from "@/ux/lib/paths";
import { PackageConsumersPanel } from "@/ux/components/catalog/package-consumers";
import { BOM_SCOPE_META } from "@/ux/lib/domain";

/** Spec 074 — sort options for the where-used rollup. */
const PACKAGE_SORT_OPTIONS: ListSortOption<PackagesSortKey>[] = [
  { sort: "components", order: "desc", label: "Most components" },
  { sort: "components", order: "asc", label: "Fewest components" },
  { sort: "name", order: "asc", label: "Name" },
  { sort: "name", order: "desc", label: "Name (Z–A)" },
  { sort: "versions", order: "desc", label: "Most versions" },
  { sort: "ecosystem", order: "asc", label: "Ecosystem" },
];

const PACKAGE_FILTERS: { [K in PackagesFilterKey]: ListFilterConfig } = {
  ecosystem: { default: "all" },
  scope: {
    default: "all",
    values: ["all", ...Object.keys(BOM_SCOPE_META)],
  },
  // Accepted for URL round-trip; stays inert until Phase 2 (D6).
  catalog: { default: "all", values: ["all", "linked", "suggested", "none"] },
};

export function UxPackagesPage() {
  // Gap flag G37 — page renders only with the Phase 1b contract.
  const enabled = flags.packagesExplorer;
  const list = useListState<PackagesSortKey, PackagesFilterKey>({
    sortKeys: PACKAGES_SORT_KEYS,
    defaultSort: "components",
    defaultOrder: "desc",
    filters: PACKAGE_FILTERS,
  });
  const [query, setQuery] = useListSearch(list);
  const { data, isPending, error, refetch } = usePackages(
    packagesListParams(list),
    { enabled },
  );
  useClampPage(list, data?.pagination);
  const [searchParams] = useSearchParams();
  const versionFilter = searchParams.get("version") ?? undefined;
  const [expanded, setExpanded] = useState<string | null>(null);
  const session = useSession();

  const rows = (data?.data ?? []).map(toPackageView);
  const pagination = data?.pagination;
  // A <2-char search is withheld from the API (FR-009) — it must not flip
  // the empty state to "no match" either (FR-010).
  const searched = query.trim().length >= 2;
  const filtersActive = PACKAGES_FILTER_KEYS.some(
    (k) => list.filters[k] !== "all",
  );

  // ?version= writes go through the list's pending-write channel so they
  // compose with same-tick managed writes (e.g. Clear filters → reset +
  // version delete) instead of clobbering them from a stale snapshot.
  const setVersionFilter = (version: string | undefined) => {
    list.mutateParams((next) => {
      if (version) next.set("version", version);
      else next.delete("version");
    });
  };

  const filters: FilterDef[] = [
    {
      id: "ecosystem",
      label: "Ecosystem",
      value: list.filters.ecosystem,
      onChange: (v) => list.setFilter("ecosystem", v),
      // Server facet: every ecosystem in the ACTIVE inventory, so a value
      // stays selectable even when the current page contains none of it.
      options: [
        { value: "all", label: "All" },
        ...(data?.facets?.ecosystems ?? []).map((v) => ({
          value: v,
          label: v,
        })),
      ],
    },
    {
      id: "scope",
      label: "Scope",
      value: list.filters.scope,
      onChange: (v) => list.setFilter("scope", v),
      options: [
        { value: "all", label: "All" },
        ...Object.entries(BOM_SCOPE_META).map(([value, m]) => ({
          value,
          label: m.label,
        })),
      ],
    },
    // In-catalog filter control only under bomCuration (Phase 2) — the
    // URL param stays accepted-and-ignored in Phase 1b (D6).
    ...(flags.bomCuration
      ? [
          {
            id: "catalog",
            label: "In catalog",
            value: list.filters.catalog,
            onChange: (v: string) => list.setFilter("catalog", v),
            options: [
              { value: "all", label: "All" },
              { value: "linked", label: "Linked" },
              { value: "suggested", label: "Suggested" },
              { value: "none", label: "Not in catalog" },
            ],
          },
        ]
      : []),
  ];

  // Flag off → zero explorer surface (hidden fallback, US1-AC5/SC-005).
  if (!enabled) {
    return <Navigate to={ux("/")} replace />;
  }

  return (
    <PageContainer>
      <PageHeader
        title="Packages"
        description="Where every package and version is used across the catalog. Inventory only: Componode does not scan for vulnerabilities."
      />
      <ListToolbar
        query={query}
        onQueryChange={setQuery}
        placeholder="Search packages by name or purl"
        resultCount={rows.length}
        total={pagination?.total ?? 0}
        filters={filters}
        end={
          <ListSortSelect
            sort={list.sort}
            order={list.order}
            onSortChange={(sort, order) => list.setSort(sort, order)}
            options={PACKAGE_SORT_OPTIONS}
          />
        }
      />
      {query.trim().length > 0 && query.trim().length < 2 && (
        <p className="text-sm text-muted-foreground" data-testid="packages-search-hint">
          Type at least 2 characters to search.
        </p>
      )}
      {isPending ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12 rounded-md" />
          ))}
        </div>
      ) : error ? (
        <ErrorState
          title="Packages unavailable"
          description={errorMessage(error)}
          onRetry={() => void refetch()}
        />
      ) : rows.length === 0 ? (
        searched || filtersActive ? (
          <EmptyState
            icon={PackageSearchIcon}
            title="No packages match"
            description="Adjust the search or clear filters to see package inventory."
            action={
              <Button
                variant="outline"
                onClick={() => {
                  list.reset();
                  setVersionFilter(undefined);
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={PackageSearchIcon}
            title="No package inventory yet"
            description="Packages appear here once an importer reports a bill of materials for a component."
            action={
              canAccess(session.data?.role ?? "VIEWER", "ADMIN") ? (
                <Button variant="outline" asChild>
                  <Link to={ux("/importers")}>Set up an importer</Link>
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <div className="flex flex-col gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Package</TableHead>
                <TableHead>Ecosystem</TableHead>
                <TableHead>Versions</TableHead>
                <TableHead className="text-right">Components</TableHead>
                {flags.bomCuration && <TableHead>In catalog</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const open = expanded === row.purl;
                return (
                  <Fragment key={row.purl}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => {
                        setExpanded(open ? null : row.purl);
                        // ?version= only ever belongs to a chip-set filter
                        // on the expanded row — expanding via the row clears it.
                        setVersionFilter(undefined);
                      }}
                      data-testid={`package-row-${row.purl}`}
                    >
                      <TableCell>
                        {open ? (
                          <ChevronDownIcon className="size-4" aria-label="Collapse" />
                        ) : (
                          <ChevronRightIcon className="size-4" aria-label="Expand" />
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">{row.name}</span>
                          <MonoValue value={row.purl} copy={false} className="text-xs" />
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{row.ecosystem}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1">
                          {row.versions.map((v) => (
                            <button
                              key={v.version}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpanded(row.purl);
                                setVersionFilter(
                                  versionFilter === v.version ? undefined : v.version,
                                );
                              }}
                              data-testid={`version-chip-${v.version}`}
                            >
                              <Badge
                                variant={
                                  versionFilter === v.version && open
                                    ? "default"
                                    : "outline"
                                }
                              >
                                {v.version} × {v.componentCount}
                              </Badge>
                            </button>
                          ))}
                          {row.versionsOverflow > 0 && (
                            <span className="text-xs text-muted-foreground">
                              +{row.versionsOverflow} more
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {row.componentCount}
                      </TableCell>
                      {flags.bomCuration && (
                      <TableCell>
                        {row.catalogComponent ? (
                          <Link
                            to={ux(`/components/${row.catalogComponent.slug}`)}
                            className="hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {row.catalogComponent.name}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      )}
                    </TableRow>
                    {open && (
                      <TableRow data-testid={`consumers-${row.purl}`}>
                        <TableCell colSpan={flags.bomCuration ? 6 : 5} className="bg-muted/40 p-0">
                          <PackageConsumersPanel
                            purl={row.purl}
                            version={versionFilter}
                            onVersionFilter={setVersionFilter}
                          />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
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
