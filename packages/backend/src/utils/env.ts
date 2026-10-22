/** Positive-integer env override with fallback — invalid/unset → fallback.
 *  Shared by the agent session and remote-run services (timing tunables are
 *  intentionally env-overridable for tests; spec defaults are supported). */
export function envInt(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
