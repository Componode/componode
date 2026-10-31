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
  historyAggregates: true,
  /** Session device column (gap 2). */
  sessionDevice: true,
  /** Session location column (gap 2). */
  sessionLocation: true,
  /** Owning user on the sessions list (gap 2). */
  sessionOwner: true,
  /** "This device" marker — the API cannot identify the caller's session (gap 2). */
  sessionCurrent: true,
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
  /** Component-list Health column — backed by the worstStatus rollup (spec 039, G21 resolved). */
  componentListHealth: true,
  /** Component-list Last-seen column — backed by the instance lastSeenAt rollup (spec 039, G21 resolved). */
  componentListLastSeen: true,
  /** Team-list Members column — backed by memberCount/componentCount (spec 039, G22 resolved). */
  teamMemberCounts: true,
  /** GONE instances on component detail — needs includeGone on the detail read (gap G26). */
  detailGoneInstances: false,
  /** Manual component/group creation — needs POST endpoints + forms (gap G29). */
  manualEntityCreate: false,
  /** Suggestions decided-history view — ACCEPTED/DISMISSED/SUPERSEDED reads (gap G32). */
  suggestionsHistory: false,
} as const;

export type GapFlag = keyof typeof flags;
