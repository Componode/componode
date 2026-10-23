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
  /** "Send password reset" action — admin token generation exists (POST /auth/password/reset). */
  passwordReset: true,
  /** Expired-credential state chip/rule (gap 5). */
  credentialExpiredState: false,
  /** Schema-driven scope fields; JSON editor fallback meanwhile (gap 13). */
  jsonScopeEditor: true,
  /** Notification channel preferences — no backend (gap 15). */
  notifications: false,
  /** Two-factor authentication — no backend (gap 16). */
  twoFactor: false,
  /** Session concurrency/IP-binding controls — no backend (gap 17). */
  sessionConcurrency: false,
  /** Workspace name/URL/regional fields — no backend (gap 18). */
  workspaceProfile: false,
  /** Retention policy + catalog export actions — no backend (gap 19). */
  advancedOps: false,
  /** Client display prefs (density/reduced-motion/relative-time) not yet consumed (gap 20). */
  displayPrefs: false,
} as const;

export type GapFlag = keyof typeof flags;
