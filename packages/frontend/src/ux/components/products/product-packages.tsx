import { Fragment } from "react";
import { ChevronDownIcon, ChevronRightIcon, PackageSearchIcon } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import {
  PRODUCT_PACKAGES_FILTER_KEYS,
  PRODUCT_PACKAGES_SORT_KEYS,
  productPackagesListParams,
  useProductPackages,
  type ProductPackagesFilterKey,
  type ProductPackagesSortKey,
} from "@/api/hooks/product-packages";
import { ListPagination } from "@/ux/components/patterns/list-pagination";
import { ListSortSelect, type ListSortOption } from "@/ux/components/patterns/list-sort-select";
import { ListToolbar, type FilterDef } from "@/ux/components/patterns/list-toolbar";
import { EmptyState, ErrorState } from "@/ux/components/patterns/states";
import { MonoValue, RelativeTime } from "@/ux/components/patterns/primitives";
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
import { toProductPackageView } from "@/api/mappers/packages";
import { errorMessage } from "@/ux/lib/api-state";
import { isStale } from "@/ux/lib/stale";
import { ux } from "@/ux/lib/paths";
import type { DepSource } from "@componode/core";
import { ProductPackageConsumersPanel, depSourceLabel } from "./product-package-consumers";

/** Spec 080 — sort options for the product package roll-up. */
const SORT_OPTIONS: ListSortOption<ProductPackagesSortKey>[] = [
  { sort: "components", order: "desc", label: "Most components" },
  { sort: "components", order: "asc", label: "Fewest components" },
  { sort: "name", order: "asc", label: "Name" },
  { sort: "name", order: "desc", label: "Name (Z–A)" },
  { sort: "versions", order: "desc", label: "Most versions" },
  { sort: "ecosystem", order: "asc", label: "Ecosystem" },
];

const FILTERS: { [K in ProductPackagesFilterKey]: ListFilterConfig } = {
  ecosystem: { default: "all" },
  skew: { default: "all", values: ["all", "true"] },
  declared: { default: "all", values: ["all", "declared", "undeclared"] },
};

/** Declared-signal cell: the DepSource attribution or an undeclared dash. */
function DeclaredCell({ declared }: { declared: DepSource | null }) {
  if (!declared) return <span className="text-muted-foreground">—</span>;
  return <Badge variant="secondary">{depSourceLabel(declared)}</Badge>;
}

/**
 * Spec 080 — the Packages tab on product detail: every distinct package
 * reported across the product's reachable components, grouped on
 * version-free purl, with the declared-dependency signal, coverage line,
 * and per-row freshness. Read-only (D7 parity); stale is the only warning
 * tone (D8).
 */
export function ProductPackagesPanel({ slug }: { slug: string }) {
  const list = useListState<ProductPackagesSortKey, ProductPackagesFilterKey>({
    sortKeys: PRODUCT_PACKAGES_SORT_KEYS,
    defaultSort: "components",
    defaultOrder: "desc",
    filters: FILTERS,
  });
  const [query, setQuery] = useListSearch(list);
  const { data, isPending, error, refetch } = useProductPackages(
    slug,
    productPackagesListParams(list),
  );
  useClampPage(list, data?.pagination);
  const [searchParams] = useSearchParams();
  const versionFilter = searchParams.get("version") ?? undefined;
  const expanded = searchParams.get("pkg");

  const rows = (data?.data ?? []).map(toProductPackageView);
  const pagination = data?.pagination;
  const coverage = data?.coverage;
  const staleThresholdDays = data?.staleThresholdDays ?? 7;
  const searched = query.trim().length >= 2;
  const filtersActive = PRODUCT_PACKAGES_FILTER_KEYS.some(
    (k) => list.filters[k] !== "all",
  );

  const setVersionFilter = (version: string | undefined) => {
    list.mutateParams((next) => {
      if (version) next.set("version", version);
      else next.delete("version");
    });
  };

  const setExpanded = (purl: string | null) => {
    list.mutateParams((next) => {
      if (purl) next.set("pkg", purl);
      else next.delete("pkg");
      next.delete("version");
    });
  };

  const filters: FilterDef[] = [
    {
      id: "ecosystem",
      label: "Ecosystem",
      value: list.filters.ecosystem,
      onChange: (v) => list.setFilter("ecosystem", v),
      options: [
        { value: "all", label: "All" },
        ...(data?.facets?.ecosystems ?? []).map((v) => ({
          value: v,
          label: v,
        })),
      ],
    },
    {
      id: "skew",
      label: "Versions",
      value: list.filters.skew,
      onChange: (v) => list.setFilter("skew", v),
      options: [
        { value: "all", label: "All" },
        { value: "true", label: "Multiple versions" },
      ],
    },
    {
      id: "declared",
      label: "Declared",
      value: list.filters.declared,
      onChange: (v) => list.setFilter("declared", v),
      options: [
        { value: "all", label: "All" },
        { value: "declared", label: "Declared" },
        { value: "undeclared", label: "Undeclared" },
      ],
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Packages reported across this product&apos;s components
        {coverage && (
          <span data-testid="product-packages-coverage">
            {" — "}{coverage.reporting} of {coverage.total} reporting
          </span>
        )}.
        Inventory only: Componode does not scan for vulnerabilities.
      </p>
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
            options={SORT_OPTIONS}
          />
        }
      />
      {query.trim().length > 0 && query.trim().length < 2 && (
        <p className="text-sm text-muted-foreground" data-testid="product-packages-search-hint">
          Type at least 2 characters to search.
        </p>
      )}
      {isPending ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }, (_, i) => (
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
            description="Adjust the search or clear filters to see this product's package inventory."
            action={
              <Button
                variant="outline"
                onClick={() => {
                  list.reset();
                  setExpanded(null);
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : coverage?.reachable === 0 ? (
          <EmptyState
            icon={PackageSearchIcon}
            title="No component dependencies"
            description="This product does not declare any component dependencies yet."
          />
        ) : (
          <EmptyState
            icon={PackageSearchIcon}
            title="No package data reported"
            description="None of this product's components have reported a bill of materials yet."
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
                <TableHead>Declared</TableHead>
                <TableHead>Last reported</TableHead>
                <TableHead className="text-right">Components</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const open = expanded === row.purl;
                const stale = isStale(row.lastReportedAt, staleThresholdDays);
                return (
                  <Fragment key={row.purl}>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setExpanded(open ? null : row.purl)}
                      data-testid={`product-package-row-${row.purl}`}
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
                                list.mutateParams((next) => {
                                  next.set("pkg", row.purl);
                                  if (versionFilter === v.version) next.delete("version");
                                  else next.set("version", v.version);
                                });
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
                      <TableCell>
                        {row.catalogComponent ? (
                          <Link
                            to={ux(`/components/${row.catalogComponent.slug}`)}
                            className="hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <DeclaredCell declared={row.declared} />
                          </Link>
                        ) : (
                          <DeclaredCell declared={row.declared} />
                        )}
                      </TableCell>
                      <TableCell
                        className={
                          stale ? "tabular text-warning" : "tabular text-muted-foreground"
                        }
                        data-testid={stale ? `stale-${row.purl}` : undefined}
                      >
                        <RelativeTime iso={row.lastReportedAt} />
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {row.componentCount}
                      </TableCell>
                    </TableRow>
                    {open && (
                      <TableRow data-testid={`consumers-${row.purl}`}>
                        <TableCell colSpan={7} className="bg-muted/40 p-0">
                          <ProductPackageConsumersPanel
                            slug={slug}
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
    </div>
  );
}
