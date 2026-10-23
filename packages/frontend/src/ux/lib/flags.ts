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
  /** Per-run change feed (gap 3). */
  runChangeFeed: false,
  /** "Send password reset" action (gap 4). */
  passwordReset: false,
  /** Expired-credential state chip/rule (gap 5). */
  credentialExpiredState: false,
  /** Importer usage list filtered by credentialId (gap 6). */
  credentialUsageFilter: false,
  /** Product bulk-import endpoint (gap — flagged only if absent at T022). */
  productBulkImport: false,
  /** Component dependents endpoint for the promote flow (gap — T024). */
  componentDependents: false,
} as const;

export type GapFlag = keyof typeof flags;
