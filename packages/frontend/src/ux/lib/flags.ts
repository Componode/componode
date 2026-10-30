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
  /** Component-list Health column — needs per-row instance rollup on GET /components (gap G21). */
  componentListHealth: false,
  /** Component-list Last-seen column — needs lastSeenAt on GET /components (gap G21). */
  componentListLastSeen: false,
  /** Team-list Members column — needs member counts on GET /teams (gap G22). */
  teamMemberCounts: false,
  /** Stat-grid "+N this week" deltas — needs dashboard delta fields (gap G23). */
  statDeltas: false,
  /** Attention-row detail sub-line — needs backend detail strings (gap G24). */
  attentionDetail: false,
  /** CREDENTIAL_EXPIRING attention kind — needs backend kind emission (gap G24). */
  credentialExpiring: false,
  /** Agent "Enrolled by" header — needs createdBy on GET /agents/:id (gap G25). */
  agentEnrolledBy: false,
  /** GONE instances on component detail — needs includeGone on the detail read (gap G26). */
  detailGoneInstances: false,
  /** Manual component/group creation — needs POST endpoints + forms (gap G29). */
  manualEntityCreate: false,
  /** Suggestions decided-history view — ACCEPTED/DISMISSED/SUPERSEDED reads (gap G32). */
  suggestionsHistory: false,
} as const;

export type GapFlag = keyof typeof flags;
