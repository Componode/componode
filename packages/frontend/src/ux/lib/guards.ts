// Shared allowlisted-detail shapers (ADR-121): bounded renderers in
// docker-details.tsx / github-details.tsx extract only contract-named
// keys — these guards keep that extraction terse and identical.

export const asObj = <T,>(v: unknown): T | null =>
  v && typeof v === "object" ? (v as T) : null

export const hasDefined = (o: object) =>
  Object.values(o).some((v) => v !== undefined)

export const str = (v: unknown) => (typeof v === "string" && v ? v : undefined)
export const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : undefined
export const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined)

export const strArr = (v: unknown) => {
  if (!Array.isArray(v)) return undefined
  const out = v.filter((x): x is string => typeof x === "string" && x.length > 0)
  return out.length ? out : undefined
}
