import { useMemo, useState, useEffect } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ChevronLeft, ChevronRight, PackageSearch, PackagePlus } from "lucide-react";
import { useComponents, type ComponentListFilters } from "@/api/hooks/components";
import { roleAtLeast } from "@/lib/roles";
import { useSession } from "@/api/hooks/auth";
import { ProductForm } from "@/components/products/product-form";
import { ComponentFilters } from "@/components/component-filters";
import { ComponentSearch } from "@/components/component-search";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { TableSkeleton } from "@/components/states/skeletons";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Forbidden } from "@/components/states/forbidden";
import { StatusBadge } from "@/components/states/status-badge";
import { SunsetBadge } from "@/components/metadata/sunset-badge";
import { Input } from "@/components/ui/input";
import type { ApiError } from "@/api/client";
import type { ComponentListResponse } from "@/api/types";

const DEFAULT_FILTERS: ComponentListFilters = {
  page: 1,
  pageSize: 50,
  sort: "name",
  order: "asc",
};

function filtersFromSearchParams(params: URLSearchParams): ComponentListFilters {
  return {
    page: Number(params.get("page") || DEFAULT_FILTERS.page),
    pageSize: Number(params.get("pageSize") || DEFAULT_FILTERS.pageSize),
    sort: (params.get("sort") as ComponentListFilters["sort"]) || DEFAULT_FILTERS.sort!,
    order: (params.get("order") as "asc" | "desc") || DEFAULT_FILTERS.order!,
    category: params.get("category") ?? undefined,
    provider: params.get("provider") ?? undefined,
    lifecycle: params.get("lifecycle") ?? undefined,
    status: params.get("status") ?? undefined,
    group: params.get("group") ?? undefined,
    tag: params.get("tag") ?? undefined,
    search: params.get("search") ?? undefined,
  };
}

function filtersToSearchParams(filters: ComponentListFilters): URLSearchParams {
  const params = new URLSearchParams();
  (Object.keys(filters) as Array<keyof ComponentListFilters>).forEach((key) => {
    const value = filters[key];
    if (value === undefined || value === "") return;
    params.set(key, String(value));
  });
  return params;
}

export function ComponentsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { data: user } = useSession();
  const editor = roleAtLeast(user?.role);
  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams]);

  const { data, isPending, isFetching, error, refetch } = useComponents(filters);

  // Spec 021 US2: multi-select ACTIVE rows → "create product from components".
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [createFromOpen, setCreateFromOpen] = useState(false);

  // Selections only make sense against the visible set — drop them when the
  // filter/page changes so invisible ids can't leak into "Create product".
  useEffect(() => {
    setSelected(new Set());
  }, [filters]);

  const [displayData, setDisplayData] = useState<ComponentListResponse["data"]>([]);
  const [pagination, setPagination] = useState<ComponentListResponse["pagination"]>({
    page: filters.page ?? 1,
    pageSize: filters.pageSize ?? 50,
    total: 0,
    pageCount: 0,
    hasNext: false,
  });

  useEffect(() => {
    if (data?.data) setDisplayData(data.data);
    if (data?.pagination) setPagination(data.pagination);
  }, [data]);

  const components = displayData;
  const page = filters.page ?? 1;
  const total = pagination.total;
  const totalPages = Math.max(1, pagination.pageCount);

  function setFilters(next: ComponentListFilters) {
    setSearchParams(filtersToSearchParams(next));
  }

  function setSearch(search: string) {
    setFilters({ ...filters, search: search || undefined, page: 1 });
  }

  function setPage(next: number) {
    setFilters({ ...filters, page: next });
  }

  const hasActiveFilters = !!(
    filters.category || filters.provider || filters.lifecycle ||
    filters.status || filters.group || filters.tag || filters.search
  );

  function clearFilters() {
    setFilters({
      ...filters,
      category: undefined, provider: undefined, lifecycle: undefined,
      status: undefined, group: undefined, tag: undefined, search: undefined, page: 1,
    });
  }

  const isForbidden = error ? ((error as unknown) as ApiError).code === "FORBIDDEN" : false;

  return (
    <div className="bg-background p-6">
      <h1 className="text-2xl font-bold mb-4">Components</h1>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-base">Catalog filters</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <ComponentSearch value={filters.search ?? ""} onChange={setSearch} />
            <Input
              placeholder="Tag…"
              value={filters.tag ?? ""}
              onChange={(e) => setFilters({ ...filters, tag: e.target.value || undefined, page: 1 })}
              className="w-32"
              aria-label="Filter by tag"
            />
            <ComponentFilters filters={filters} onChange={setFilters} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isPending && components.length === 0 && <TableSkeleton />}

          {!isPending && isForbidden && <Forbidden />}

          {!isPending && !isForbidden && error && (
            <ErrorState error={error} onRetry={() => refetch()} />
          )}

          {!isPending && !error && components.length === 0 && (
            <EmptyState
              icon={PackageSearch}
              title={hasActiveFilters ? "No components match the filters" : "No components found"}
              description={
                hasActiveFilters
                  ? "Try removing or broadening the active filters."
                  : "Run an importer to populate the catalog."
              }
              action={
                hasActiveFilters
                  ? { label: "Clear filters", onClick: clearFilters }
                  : { label: "Configure importers", to: "/importers" }
              }
            />
          )}

          {!isPending && !error && components.length > 0 && (
            <>
              {editor && selected.size > 0 && (
                <div className="flex items-center justify-between border-b bg-muted/50 px-4 py-2">
                  <p className="text-sm font-medium">{selected.size} selected</p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelected(new Set())}
                    >
                      Clear
                    </Button>
                    <Button size="sm" onClick={() => setCreateFromOpen(true)}>
                      <PackagePlus className="mr-2 h-4 w-4" /> Create product
                    </Button>
                  </div>
                </div>
              )}
              <Table>
                <TableHeader>
                  <TableRow>
                    {editor && (
                      <TableHead className="w-8">
                        <input
                          type="checkbox"
                          aria-label="Select all active components"
                          className="h-4 w-4"
                          checked={
                            components.filter((c) => c.lifecycle === "ACTIVE")
                              .length > 0 &&
                            components
                              .filter((c) => c.lifecycle === "ACTIVE")
                              .every((c) => selected.has(c.id))
                          }
                          onChange={(e) => {
                            const active = components
                              .filter((c) => c.lifecycle === "ACTIVE")
                              .map((c) => c.id);
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) active.forEach((id) => next.add(id));
                              else active.forEach((id) => next.delete(id));
                              return next;
                            });
                          }}
                        />
                      </TableHead>
                    )}
                    <TableHead>Name</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Provider</TableHead>
                    <TableHead>Resource type</TableHead>
                    <TableHead>Lifecycle</TableHead>
                    <TableHead>Sunset</TableHead>
                    <TableHead>Group</TableHead>
                    <TableHead className="text-right">Instances</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {components.map((component) => (
                    <TableRow key={component.id}>
                      {editor && (
                        <TableCell className="w-8">
                          {component.lifecycle === "ACTIVE" && (
                            <input
                              type="checkbox"
                              aria-label={`Select ${component.name}`}
                              className="h-4 w-4"
                              checked={selected.has(component.id)}
                              onChange={(e) => {
                                setSelected((prev) => {
                                  const next = new Set(prev);
                                  if (e.target.checked) next.add(component.id);
                                  else next.delete(component.id);
                                  return next;
                                });
                              }}
                            />
                          )}
                        </TableCell>
                      )}
                      <TableCell>
                        <Link
                          to={`/components/${component.id}`}
                          className="font-medium hover:underline"
                        >
                          {component.name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="bg-muted text-muted-foreground">{component.category}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="bg-muted text-muted-foreground">{component.provider}</Badge>
                      </TableCell>
                      <TableCell>{component.resourceType}</TableCell>
                      <TableCell>
                        <StatusBadge status={component.lifecycle} />
                      </TableCell>
                      <TableCell>
                        <SunsetBadge sunsetAt={component.sunsetAt} lifecycle={component.lifecycle} />
                      </TableCell>
                      <TableCell>
                        {component.componentGroupName ?? "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {component.instanceCount}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              <div className="flex items-center justify-between p-4 border-t">
                <p className="text-sm text-muted-foreground">
                  {total} component{total === 1 ? "" : "s"} · Page {page} of {totalPages}
                </p>
                <div className="flex items-center gap-2">
                  {isFetching && components.length > 0 && (
                    <span className="text-xs text-muted-foreground">Updating…</span>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page - 1)}
                    disabled={page <= 1}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage(page + 1)}
                    disabled={page >= totalPages}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <ProductForm
        open={createFromOpen}
        onClose={() => setCreateFromOpen(false)}
        componentIds={[...selected]}
        onCreated={(product) => {
          setSelected(new Set());
          navigate(`/products/${product.slug}`);
        }}
      />
    </div>
  );
}
