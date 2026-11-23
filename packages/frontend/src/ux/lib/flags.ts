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
 *
 * E2E escape hatch (FR-018 coverage): `localStorage["componode.flag.<name>"]
 * = "true"|"false"` overrides a flag at module load, before the app mounts —
 * Playwright sets it via `page.addInitScript`. Not a runtime toggle.
 */
const flagOverride = (name: string): boolean | undefined => {
  try {
    const v = globalThis.localStorage?.getItem(`componode.flag.${name}`);
    return v == null ? undefined : v === "true";
  } catch {
    return undefined;
  }
};

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
  /** Component-list Health column — backed by the worstStatus rollup (spec 039, G21 resolved). */
  componentListHealth: true,
  /** Component-list Last-seen column — backed by the instance lastSeenAt rollup (spec 039, G21 resolved). */
  componentListLastSeen: true,
  /** Team-list Members column — backed by memberCount/componentCount (spec 039, G22 resolved). */
  teamMemberCounts: true,
  /** GONE instances on component detail — needs includeGone on the detail read (gap G26). */
  detailGoneInstances: false,
  /** Nested profile/instance/check builder for Web/API collection importers (gap G33, spec 058). */
  importerProfileBuilder: true,
  /** Read-only typed Component relationships read + tab (gap G35, spec 060). */
  componentRelationships: true,
  /** Bill of Materials tab + BOM list filter/run counters (gap G36, spec 073
   *  — ON with the Phase 1 contract: /components/:id/bom + summary + instance read). */
  componentBom: true,
  /** Packages explorer + consumers read (gap G37, spec 074 — ON with the
   *  Phase 1b contract: /packages + /packages/consumers). */
  packagesExplorer: flagOverride("packagesExplorer") ?? true,
  /** Phase-2 BOM catalog curation (gap G38, spec 075 — ON with curation
   *  endpoints + dependency queue + library legibility surfaces). */
  bomCuration: flagOverride("bomCuration") ?? true,
  /** Phase-3 importer-declared edges (gap G39, spec 076 — ON with edge
   *  provenance on the relationships read + POST /component-edge-suppressions
   *  + the importer opt-in field). Surfaces hidden, never disabled, when off. */
  bomImporterEdges: flagOverride("bomImporterEdges") ?? true,
} as const;

export type GapFlag = keyof typeof flags;
