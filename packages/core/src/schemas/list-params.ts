import { z } from "zod";

/**
 * Shared list-query primitives (spec 068 / ADR-130): every standardized
 * list endpoint accepts `page`, `pageSize`, `order`, and `search` on top of
 * its endpoint-specific `sort` whitelist and filters, and returns the
 * `{data, pagination}` envelope below.
 *
 * Endpoint schemas extend {@link listParamsBaseSchema} and add their own
 * strict `.strict()` object — unknown query params are rejected (ADR-095).
 */

/** `page` — 1-based page index, coerced from the query string. */
export const listPageSchema = z.coerce.number().int().min(1).default(1);

/** `pageSize` — rows per page, clamped to the contract's 1–100 window. */
export const listPageSizeSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(100)
  .default(25);

/** `order` direction enum (no default — endpoints pick their own). */
export const listOrderValues = ["asc", "desc"] as const;
export const listOrderSchema = z.enum(listOrderValues);

/** `search` — optional free-text fragment, bounded for LIKE safety. */
export const listSearchSchema = z.string().max(100).optional();

/**
 * Base params shared by every standardized list endpoint. Endpoint schemas
 * `.extend()` this with their `sort` whitelist + filters and finish with
 * `.strict()`.
 */
export const listParamsBaseSchema = z.object({
  page: listPageSchema,
  pageSize: listPageSizeSchema,
  order: listOrderSchema.default("asc"),
  search: listSearchSchema,
});

/** Sort direction accepted by list endpoints (`asc` default via base). */
export type ListOrder = z.infer<typeof listOrderSchema>;

/**
 * Coerces a query-string boolean-ish value (`"true"`, `"1"`, `true`) to a
 * boolean; everything else is false. Used inside `z.preprocess` for filter
 * params that arrive as strings.
 */
export function toBooleanParam(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value === "true" || value === "1";
  return false;
}

/**
 * Optional boolean query param: absent → `undefined` (filter not applied);
 * present → coerced via {@link toBooleanParam}.
 */
export const optionalBooleanParam = z.preprocess(
  (v) => (v === undefined ? undefined : toBooleanParam(v)),
  z.boolean().optional(),
);

/** Splits comma-joined facet params; each value is then enum-validated. */
export const splitCsvParam = (v: string | string[]) =>
  (Array.isArray(v) ? v : [v])
    .flatMap((s) => s.split(","))
    .map((s) => s.trim())
    .filter(Boolean);

/** Pagination envelope metadata returned by every standardized list. */
export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  pageCount: number;
  hasNext: boolean;
}

/**
 * Standardized list response envelope (spec 068 / ADR-130):
 * `{data: T[], pagination: {page, pageSize, total, pageCount, hasNext}}`.
 */
export interface Paginated<T> {
  data: T[];
  pagination: PaginationMeta;
}
