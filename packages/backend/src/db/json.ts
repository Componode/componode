// Kysely models jsonb columns as their parsed shape, but the pg driver
// serializes objects poorly — stringify at the boundary and keep the
// column's declared type at the call site.
export function toJsonb<T>(value: T): T {
  return JSON.stringify(value) as unknown as T;
}
