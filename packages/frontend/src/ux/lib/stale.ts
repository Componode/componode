/** Shared staleness predicate (bom.staleThresholdDays, spec 073/080). */
export function isStale(iso: string | null, thresholdDays: number): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() > thresholdDays * 86_400_000;
}
