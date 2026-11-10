import { sql, type RawBuilder, type SelectQueryBuilder } from "kysely";
import type { Paginated, PaginationMeta } from "@componode/core";

/**
 * Shared offset-pagination runner for the spec 068 / ADR-130 list contract.
 *
 * The caller builds `filtered` — a select query carrying its FROM/JOINs,
 * WHERE clauses, and SELECT list (ordering may reference select aliases),
 * with NO `orderBy`/`limit`/`offset` applied — then hands it here with the
 * parsed `page`/`pageSize` and an `orderBy` callback that applies the
 * endpoint's whitelisted sort expression(s) plus a deterministic id
 * tie-break (e.g. `.orderBy("components.id", order)`).
 *
 * The helper runs the count query over the SAME filtered builder
 * (select/order stripped), applies `LIMIT`/`OFFSET`, and returns the
 * `{data, pagination}` envelope. All queries stay parameterized — sort
 * expressions come from per-endpoint whitelists, never raw input
 * (ADR-084/ADR-095).
 */
export interface PageParams {
  page: number;
  pageSize: number;
}

/**
 * An orderable target accepted by Kysely's `orderBy`: a column reference
 * (table-qualified or a select alias) or a `sql` template expression
 * (e.g. the audit feed's computed sort keys).
 */
export type OrderTarget = string | RawBuilder<unknown>;

/**
 * Resolves a whitelisted sort key to its orderable target (spec 069 /
 * B.3). `map` keys MUST mirror the endpoint's Zod sort enum — the map is
 * a lookup, never a second whitelist: unknown keys already fail schema
 * validation upstream (ADR-095), and `fallback` covers a null/undefined
 * sort for callers whose schema leaves it optional.
 *
 * String targets go through `sql.ref` — Kysely's typed `orderBy` only
 * accepts compile-time column references, while the map's whole point is
 * runtime lookup. `sql.ref` emits the identical reference node (and the
 * values are static map entries, never user input — the sort *key* is
 * what Zod whitelists, ADR-095).
 */
export function sortTarget<S extends string>(
  map: Record<S, OrderTarget>,
  sort: string | null | undefined,
  fallback: OrderTarget,
): RawBuilder<unknown> {
  const target = (sort != null ? map[sort as S] : undefined) ?? fallback;
  return typeof target === "string" ? sql.ref(target) : target;
}

/** Computes the contract pagination envelope for a filtered result set. */
export function paginationMeta(
  total: number,
  page: number,
  pageSize: number,
): PaginationMeta {
  return {
    page,
    pageSize,
    total,
    pageCount: total === 0 ? 0 : Math.ceil(total / pageSize),
    hasNext: page * pageSize < total,
  };
}

export interface PaginateOptions<DBType, TB extends keyof DBType, O> {
  /**
   * Applies the endpoint's whitelisted ORDER BY — primary sort plus the
   * deterministic id tie-break — to the already-selected query. Must not
   * add LIMIT/OFFSET (the helper owns those).
   */
  orderBy: (
    query: SelectQueryBuilder<DBType, TB, O>,
  ) => SelectQueryBuilder<DBType, TB, O>;
}

export async function paginateQuery<DBType, TB extends keyof DBType, O>(
  filtered: SelectQueryBuilder<DBType, TB, O>,
  params: PageParams,
  options: PaginateOptions<DBType, TB, O>,
): Promise<Paginated<O>> {
  const ordered = options.orderBy(filtered);
  const offset = (params.page - 1) * params.pageSize;

  const [countRow, data] = await Promise.all([
    filtered
      .clearOrderBy()
      .clearSelect()
      .select((eb) => [eb.fn.countAll().as("total")])
      .executeTakeFirst(),
    ordered.limit(params.pageSize).offset(offset).execute(),
  ]);

  const total = Number(
    (countRow as { total?: string | number | bigint } | undefined)?.total ?? 0,
  );
  return {
    data,
    pagination: paginationMeta(total, params.page, params.pageSize),
  };
}
