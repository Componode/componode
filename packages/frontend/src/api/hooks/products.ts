import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import { fetchAllPages, type ListQueryState } from "@/api/list-query";
import type {
  ProductListResponse,
  ProductDetail,
  DigitalProduct,
  Link,
  BootstrapReport,
} from "@/api/types";

/** Spec 068 / ADR-130 sort whitelist for `GET /products` (contract doc). */
export const PRODUCTS_SORT_KEYS = [
  "name",
  "type",
  "owner",
  "criticality",
  "updated",
] as const;
export type ProductsSortKey = (typeof PRODUCTS_SORT_KEYS)[number];

/** URL filter keys managed by the /products list page (useListState). */
export const PRODUCTS_FILTER_KEYS = [
  "type",
  "criticality",
  "lifecycle",
  "missing",
] as const;
export type ProductsFilterKey = (typeof PRODUCTS_FILTER_KEYS)[number];

/**
 * Spec 068: the legacy `q` param was renamed to the shared `search` param —
 * `q` is rejected by the strict query schema. `missing` stays a CSV of
 * `owner|dependencies|description`.
 */
export interface ProductListParams {
  page?: number;
  pageSize?: number;
  sort?: ProductsSortKey;
  order?: "asc" | "desc";
  search?: string;
  type?: string;
  lifecycle?: string;
  tag?: string;
  criticality?: string;
  /** Spec 023: completeness-gap facet — CSV of owner/dependencies/description. */
  missing?: string;
  includeRetired?: boolean;
}

/** `missing=incomplete` sentinel → every completeness facet (spec 068). */
export const PRODUCTS_MISSING_INCOMPLETE = "owner,dependencies,description";

/**
 * Adapts resolved `useListState` output to `/products` API params
 * (spec 068). The URL `missing` sentinel `incomplete` expands to the
 * all-facets CSV; `lifecycle` defaults to `ACTIVE` in the URL state but is
 * a REAL API filter here — it is sent whenever the filter is not `all`
 * (omitting it with `includeRetired=true` would leak RETIRED rows into the
 * default view). `includeRetired` is always sent so the `all` lifecycle
 * option and the RETIRED filter can reach retired rows.
 */
export function productsListParams(state: ListQueryState): ProductListParams {
  const f = state.filters;
  const facet = (key: string) => {
    const v = f[key];
    return v !== undefined && v !== "" && v !== "all" ? v : undefined;
  };
  const missing = f.missing;
  return {
    page: state.page,
    pageSize: state.pageSize,
    sort: (state.sort as ProductsSortKey | null) ?? "name",
    order: state.order,
    search: state.search !== "" ? state.search : undefined,
    type: facet("type"),
    criticality: facet("criticality"),
    lifecycle: facet("lifecycle"),
    missing:
      missing === "incomplete"
        ? PRODUCTS_MISSING_INCOMPLETE
        : missing !== undefined && missing !== "" && missing !== "all"
          ? missing
          : undefined,
    includeRetired: true,
  };
}

function buildProductsQs(params: ProductListParams): string {
  const search = new URLSearchParams();
  if (params.page !== undefined) search.set("page", String(params.page));
  if (params.pageSize !== undefined) search.set("pageSize", String(params.pageSize));
  if (params.sort) search.set("sort", params.sort);
  if (params.order) search.set("order", params.order);
  if (params.search) search.set("search", params.search);
  if (params.type) search.set("type", params.type);
  if (params.lifecycle) search.set("lifecycle", params.lifecycle);
  if (params.tag) search.set("tag", params.tag);
  if (params.criticality) search.set("criticality", params.criticality);
  if (params.missing) search.set("missing", params.missing);
  if (params.includeRetired) search.set("includeRetired", "true");
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export function useProducts(params: ProductListParams = {}, enabled = true) {
  const qs = buildProductsQs(params);
  return useQuery({
    queryKey: ["products", qs],
    enabled,
    queryFn: () => api<ProductListResponse>(`/products${qs}`),
    placeholderData: (prev) => prev, // preserve data during refetch (docs/ux.md §6)
  });
}

/**
 * Fetch every matching product by paging through the list endpoint
 * (pageSize caps at 100) — for pickers that must offer the full set
 * (spec 068: list pages consume one page at a time).
 */
export function useAllProducts(
  params: Omit<ProductListParams, "page" | "pageSize"> = {},
  enabled = true,
) {
  return useQuery({
    queryKey: ["products", "all", params],
    enabled,
    queryFn: () =>
      fetchAllPages((page) =>
        api<ProductListResponse>(
          `/products${buildProductsQs({ ...params, page, pageSize: 100 })}`,
        ),
      ),
  });
}

export function useProduct(slug: string | undefined) {
  return useQuery({
    queryKey: ["products", "detail", slug],
    queryFn: () => api<ProductDetail>(`/products/${slug}`),
    enabled: !!slug,
  });
}

function invalidateProducts(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ["products"] });
}

export interface ProductFormInput {
  name?: string;
  slug?: string;
  type?: string;
  description?: string | null;
  lifecycle?: string;
  lobOwnerId?: string | null;
  teamOwnerId?: string | null;
  links?: Link[];
  tags?: string[];
  criticality?: string | null;
  sunsetAt?: string | null;
  /** Spec 021 US2 fast path — wire these components on create, atomically. */
  componentIds?: string[];
}

export function useCreateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: ProductFormInput) =>
      api<{ product: DigitalProduct }>("/products", {
        method: "POST",
        body: JSON.stringify(vars),
      }),
    onSuccess: () => invalidateProducts(qc),
  });
}

export function useUpdateProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string } & ProductFormInput) => {
      // id is the URL param — updateProductSchema is .strict() and rejects it.
      const { id, ...body } = vars;
      return api<{ product: DigitalProduct }>(`/products/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => invalidateProducts(qc),
  });
}

export function useDeleteProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api<undefined>(`/products/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidateProducts(qc),
  });
}

/**
 * ADR-114 catalog bootstrap import. `document` is the raw file text — sent as
 * `application/yaml` for both YAML and JSON documents (the backend parses
 * either). `dryRun` previews the report without writes.
 */
export function useBootstrapProducts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { document: string; dryRun: boolean }) =>
      api<BootstrapReport>(
        `/products/bootstrap${vars.dryRun ? "?dryRun=true" : ""}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/yaml" },
          body: vars.document,
        },
      ),
    onSuccess: (_data, vars) => {
      if (!vars.dryRun) {
        invalidateProducts(qc);
        qc.invalidateQueries({ queryKey: ["components"] });
        qc.invalidateQueries({ queryKey: ["component-groups"] });
        qc.invalidateQueries({ queryKey: ["dashboard"] });
      }
    },
  });
}

export type EdgeKind = "composes" | "consumes-from" | "depends-on";

export function useAddEdge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; kind: EdgeKind; body: Record<string, string | string[]> }) =>
      api<undefined>(`/products/${vars.id}/${vars.kind}`, {
        method: "POST",
        body: JSON.stringify(vars.body),
      }),
    onSuccess: () => {
      invalidateProducts(qc);
      qc.invalidateQueries({ queryKey: ["components"] });
      qc.invalidateQueries({ queryKey: ["component-groups"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

export function useRemoveEdge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      id: string;
      kind: EdgeKind;
      otherId: string;
      /** depends-on targets are kind-discriminated (ADR-110 §4). */
      targetKind?: "component" | "group";
    }) =>
      api<undefined>(
        `/products/${vars.id}/${vars.kind}/${vars.otherId}${vars.targetKind ? `?kind=${vars.targetKind}` : ""}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      // Same invalidation set as useAddEdge — removing a depends-on edge
      // also changes component dependents and dashboard counts.
      invalidateProducts(qc);
      qc.invalidateQueries({ queryKey: ["components"] });
      qc.invalidateQueries({ queryKey: ["component-groups"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}
