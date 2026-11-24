import { useQuery } from "@tanstack/react-query";
import type {
  ProductPackageConsumerListItem,
  ProductPackagesResponse,
  Paginated,
} from "@componode/core";
import { api } from "@/api/client";
import { CONSUMERS_PAGE_SIZE } from "@/api/hooks/packages";
import {
  buildApiQueryString,
  facetParam,
  type ListQueryState,
} from "@/api/list-query";

/**
 * Product package roll-up read hooks (spec 080,
 * contracts/product-packages.md). Mirrors the /packages explorer hooks
 * but scoped to `GET /products/:slug/packages`; the declared filter's API
 * values are `declared`/`undeclared` and `skew` is the boolean-ish "true"
 * the schema coerces.
 */
export const PRODUCT_PACKAGES_SORT_KEYS = [
  "name",
  "components",
  "versions",
  "ecosystem",
] as const;
export type ProductPackagesSortKey =
  (typeof PRODUCT_PACKAGES_SORT_KEYS)[number];

/** URL filter keys managed by the product Packages tab (useListState). */
export const PRODUCT_PACKAGES_FILTER_KEYS = [
  "ecosystem",
  "skew",
  "declared",
] as const;
export type ProductPackagesFilterKey =
  (typeof PRODUCT_PACKAGES_FILTER_KEYS)[number];

/** API params accepted by `GET /products/:slug/packages`. */
export interface ProductPackagesListFilters {
  search?: string;
  ecosystem?: string;
  skew?: string;
  declared?: string;
  page?: number;
  pageSize?: number;
  sort?: ProductPackagesSortKey;
  order?: "asc" | "desc";
}

export type ProductPackagesPage = ProductPackagesResponse;
export type ProductPackageConsumersPage =
  Paginated<ProductPackageConsumerListItem>;

/**
 * Adapts resolved `useListState` output to `GET /products/:slug/packages`
 * params. `skew` sends only "true" ("all"/false is the unset default);
 * `declared` passes through its facet value.
 */
export function productPackagesListParams(
  state: ListQueryState,
): ProductPackagesListFilters {
  const skew = facetParam(state, "skew");
  return {
    // Sub-2-char searches are not sent — the page shows a hint instead
    // (UX-PKG-07 parity with /packages).
    search: state.search.trim().length >= 2 ? state.search.trim() : undefined,
    ecosystem: facetParam(state, "ecosystem"),
    skew: skew === "true" ? "true" : undefined,
    declared: facetParam(state, "declared"),
    page: state.page,
    pageSize: state.pageSize,
    sort: (state.sort as ProductPackagesSortKey | null) ?? "components",
    order: state.order,
  };
}

export function useProductPackages(
  slug: string,
  filters: ProductPackagesListFilters,
  options: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: ["products", slug, "packages", filters],
    queryFn: () =>
      api<ProductPackagesPage>(
        `/products/${slug}/packages${buildApiQueryString(filters)}`,
      ),
    enabled: options.enabled ?? true,
    placeholderData: (prev) => prev,
  });
}

/** `GET /products/:slug/packages/consumers` — enabled only when a purl is supplied. */
export function useProductPackageConsumers(
  slug: string,
  purl: string | null,
  options: { version?: string; page?: number; pageSize?: number } = {},
) {
  const params = {
    purl: purl ?? "",
    pageSize: CONSUMERS_PAGE_SIZE,
    ...options,
  };
  return useQuery({
    queryKey: ["products", slug, "packages", "consumers", params],
    queryFn: () =>
      api<ProductPackageConsumersPage>(
        `/products/${slug}/packages/consumers${buildApiQueryString(params)}`,
      ),
    enabled: purl !== null,
    placeholderData: (prev) => prev,
  });
}
