/**
 * Gap-flag registry for the UX rewrite (spec 029).
 *
 * Every flag corresponds to a documented backend gap in
 * `researches/ux-rewrite-gaps.md`. All flags ship OFF in v1.1.0 — the
 * flagged UI renders its fallback state (hidden column, disabled action,
 * or gap notice) until the backend capability lands and the flag flips.
 *
 * Rule: a flag may only be added alongside a detailed gap-registry entry.
 */
export const flags = {
  /** Per-day importer run aggregates for the history chart (gap 1). */
  historyAggregates: false,
  /** Session device column (gap 2). */
  sessionDevice: false,
  /** Session location column (gap 2). */
  sessionLocation: false,
  /** Owning user on the sessions list (gap 2). */
  sessionOwner: false,
  /** "Send password reset" action (gap 4). */
  passwordReset: false,
  /** Expired-credential state chip/rule (gap 5). */
  credentialExpiredState: false,
  /** Schema-driven scope fields; JSON editor fallback meanwhile (gap 13). */
  jsonScopeEditor: true,
} as const;

export type GapFlag = keyof typeof flags;
