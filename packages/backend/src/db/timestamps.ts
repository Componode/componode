// The pg driver hands timestamptz columns back as Date, while rows that were
// inserted from ISO strings (tests, seeds) may already be strings — normalize
// to ISO at the serialization boundary.
export function toIsoTimestamp(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}
