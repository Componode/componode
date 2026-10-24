/**
 * Gap-flag registry for the UX rewrite (spec 029).
 *
 * Every flag corresponds to a documented backend gap in
 * `researches/ux-rewrite-gaps.md`. Flags ship OFF unless the backend
 * capability exists — the flagged UI renders its fallback state (hidden
 * column, disabled action, or gap notice) until the capability lands and
 * the flag flips. (`passwordReset` is ON: the endpoint exists.)
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
  /** "This device" marker — the API cannot identify the caller's session (gap 2). */
  sessionCurrent: false,
  /** "Send password reset" action — admin token generation exists (POST /auth/password/reset). */
  passwordReset: true,
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
  /** Non-admin self profile save — PATCH /users/me exists (gap 14, resolved by spec 030). */
  profileSelfEdit: true,
} as const;

export type GapFlag = keyof typeof flags;
