# UX Rewrite — Backend Gap Registry

> **Purpose**: control file for the backend/API gaps discovered while porting
> the v0 UX prototype (spec `029-ux-rewrite`). The new UX renders fallback
> states behind flags in `packages/frontend/src/ux/lib/flags.ts`; each entry
> below is the seed for a future spec. Gaps are never implemented inside the
> UX feature itself — they become their own `specs/` entries for the
> v1.1.0 line or later.
>
> **Convention**: numbered entries mirror `specs/029-ux-rewrite/data-model.md`
> § Gap registry. When a gap is resolved by a shipped spec, mark it
> **Resolved by spec NNN** rather than deleting it.

## Spec queue (v1.1.x program)

Open gaps resolve as their own specs on `release/1.1.0`, in this order —
numbers are sequential at creation and may shift:

1. `030` — self-service profile (G14)
2. `031` — importer run aggregates (G1)
3. `032` — admin session visibility (G2)
4. `033` — detail reads + feed names (G7, G8, G9, G11) — RESOLVED
5. `034` — team↔LOB association (G12)
6. `037` — schema-driven importer forms (G13) — RESOLVED by spec 037 —
   `035`/`036` were taken by `035-bugfix-user-form-validation` and
   `036-bugfix-ux-findings`
7. ~~`0NN` — list enrichment (G21, G22)~~ — SHIPPED as spec `039`
8. ~~`0NN` — dashboard intelligence (G23, G24, G25)~~ — SHIPPED as spec `040`

Deferred past this program — re-triaged after it closes: G15 (merged
with the email-delivery half of G4), G16, G17, G18, G19, G26, G27, G28,
G30. Each keeps its detailed entry below (UX surface, missing backend
capability, flag, reason) — treat those entries as the standing answer
for any future question about the corresponding surface, and re-triage
them into specs when scheduled. G29/G31/G32 shipped as spec
`042-catalog-authoring`.

## G1 — Per-day importer run aggregates — RESOLVED by spec 031

- `GET /importer-configs/:id/run-aggregates?days=N` (1–90, default 14)
  returns zero-filled ascending `{day, runs, created, updated, failed}`
  buckets computed by a SQL group-by — O(days), not O(rows). The
  importer-card sparkline renders live data via `useRunAggregates`;
  `historyAggregates` is ON and the fallback notice removed.

## G2 — Session device / location / owning user — RESOLVED by spec 032

- Sessions persist `userAgent` + `ip` at creation (migration 020);
  `GET /sessions` and `GET /users/:id/sessions` return `device`
  (server-parsed "Browser · OS" label), `ip` as the location value
  (geo lookup deferred), `userId`, and a caller-relative `current`
  marker compared against the request's session hash internally.
  `sessionDevice`/`sessionLocation`/`sessionOwner`/`sessionCurrent` are
  ON; the admin tab renders the owner column and the self view marks
  "This device" with revoke suppressed.

## G3 — Per-run change feed — RESOLVED (verified T036)

- `GET /importer-configs/:id/runs/:runId/changes` exists and the run-detail
  changes tab wires `useRunChanges`. No flag needed; entry retained for
  audit trail.

## G4 — Password reset — RESOLVED (token flow)

- **Verified**: `POST /auth/password/reset` (admin) returns a reset token;
  `POST /auth/password/reset/confirm` is public. The UX wires the
  token-generation call and shows the link for copy-out.
- **Flag**: `passwordReset` ON. Email delivery merged into the deferred
  G15 notification-delivery entry — the same SMTP infrastructure serves
  both, so they land in one spec.

## G14 — Self-service profile update — RESOLVED by spec 030

- `PATCH /users/me` ships: self-bound to the session user, strict
  `updateSelfSchema` (`displayName` + `email` only — privileged keys
  rejected, not stripped), routed through `updateUser` for identical
  audit attribution. The profile page uses the self path for all roles;
  the `profileSelfEdit` flag was removed in spec 038 (resolved, zero
  consumers) and the read-only fallback is gone.

## G15 — Notification delivery & preferences — DEFERRED (unscheduled)

- **UX surface**: `/ux/settings/notifications` — event × channel matrix.
- **Need**: notification delivery infrastructure (SMTP or equivalent) plus
  a per-user preferences endpoint (none exists). Absorbs the deferred
  email-delivery half of G4 — a prefs matrix without delivery is dead
  state, so the matrix stays flagged until delivery exists.
- **Flag**: `notifications`.
- **Deferred**: no spec scheduled; re-triaged after the v1.1.x gap
  program.

## G16 — Two-factor authentication — DEFERRED (unscheduled)

- **UX surface**: `/ux/settings/security` — TOTP toggle. No backend. Hidden
  behind `twoFactor`.
- **Deferred**: no spec scheduled; re-triaged after the v1.1.x gap
  program. Needs its own ADR (enrollment, recovery, session policy).

## G17 — Session concurrency controls — DEFERRED (unscheduled)

- **UX surface**: `/ux/settings/session-policy` — one-session-per-user and
  IP-binding toggles. `AppSettings` only carries the two timeouts; hidden
  behind `sessionConcurrency`.
- **Deferred**: no spec scheduled; re-triaged after the v1.1.x gap
  program.

## G18 — Workspace profile fields — DEFERRED (unscheduled)

- **UX surface**: `/ux/settings/workspace` — workspace name/URL/regional
  defaults. `AppSettings` has no such fields; hidden behind `workspaceProfile`.
- **Deferred**: no spec scheduled; re-triaged after the v1.1.x gap
  program. Spec must check the no-Organization/tenant guardrail —
  workspace fields are org-level config.

## G19 — Retention + export operations — DEFERRED (unscheduled)

- **UX surface**: `/ux/settings/advanced` — gone-instance retention window,
  catalog export, destructive reset. No endpoints; hidden behind
  `advancedOps`.
- **Deferred**: no spec scheduled; re-triaged after the v1.1.x gap
  program. Destructive reset may split into its own spec.

## G20 — Client display preferences — RESOLVED by spec 041

- `/ux/settings/appearance` prefs (`density`, `reduceMotion`,
  `relativeTime` in `localStorage["ux.prefs"]`) are consumed app-wide via
  the shared `useUxPrefs` seam (`ux/lib/prefs.ts`): `UxPrefsSync` applies
  `data-density`/`data-reduce-motion` on `<html>` (stylesheet rules in
  `ux/styles.css` cascade compact table density and motion suppression),
  and `RelativeTime` renders `formatDateTime` when `relativeTime` is off.
  Controls enabled on the settings page; `displayPrefs` flag removed.

## G5 — Expired-credential state rule — RESOLVED (derived, T036)

- The UI derives `expired = expiresAt < now` client-side in the credentials
  table `Expiry` cell and detail-page banner (warning within 30 days). The
  API carries no expired status value; a server-side `EXPIRED` state would
  be a new enhancement, not a gap. No flag.

## G6 — `credentialId` filter on `GET /importers` — RESOLVED (verified T036)

- The usage tab reads `GET /credentials/:id` `dependents.importerConfigs`
  instead of filtering the configs list — no query param needed.

(Original entry follows for context.)

- **UX surface**: credential detail → "used by" importer list.
- **Need**: `GET /importers?credentialId=:id`.
- **Current API**: no filter; fallback is client-side filtering of the full
  importer list until the parameter lands.
- **Flag**: none (resolved during implementation).

## G7 — Team detail endpoint — RESOLVED by spec 033

- `GET /teams/:id` ships inside the `register()` block in
  `src/routes/org.ts`. The `:id` param resolves **id-or-slug** —
  UUID-shaped values match `id` first and fall back to `slug`, so the
  `/ux/teams/:slug` route resolves in one read via `useTeam`. The
  list-and-match fallback is retired.

## G8 — LOB detail endpoint — RESOLVED by spec 033

- `GET /lobs/:id` ships the same way; `/ux/lobs/:slug` resolves via
  `useLob` in one read.

## G9 — Component-group slug lookup — RESOLVED by spec 033

- `GET /component-groups/:id` accepts id-or-slug (same resolution rule);
  `/ux/component-groups/:slug` resolves via `useComponentGroup`. The
  detail read now also carries `memberCount` (matching the list row) so
  the members stat and delete-confirm copy stay truthful.

## G10 — Audit `actor` filter — RESOLVED (verified T034)

- **UX surface**: user detail → activity tab (`?actor=`).
- **Verified**: `activityFeedQuerySchema` accepts `actor`, and
  `audit-query-service.ts` matches it against `createdByName`/`createdBy`.
  The user detail activity tab wires `useActivityFeed({ actor: username })`.
  No gap — entry retained for audit trail only.

## G11 — Audit feed entity display names — RESOLVED by spec 033

- `EntityChange` gains `entityName`; `EdgeChange` gains `fromEntityName`
  and `toEntityName` — resolved server-side at read time
  (`audit-query-service.attachEntityNames`) across `/audit/activity`,
  `/audit/entities/:type/:id`, and run changes, covering all historical
  rows and renames. Unresolvable rows (deleted entities, `settings`/`auth`
  events) return null and the mapper renders the entity-kind label —
  never a raw identifier pair.

## G12 — Team ↔ LOB association — RESOLVED by spec 034

- `teams.lobId` ships (migration 021, ADR-077 Amendment 1): optional
  single-LOB association, `ON DELETE SET NULL` — deleting a LOB clears the
  link, it does not block. Team writes accept `lobId` (unknown LOB →
  `VALIDATION_FAILED`); team reads embed a resolved `lob {id,name,slug}`
  summary.
- Product form team picker **groups** rather than filters (clarified):
  the selected LOB's teams lead, all remaining teams stay reachable in an
  "Other teams" group — nothing hidden. Team form assigns the LOB; team
  detail shows it (linked); LOB detail lists its teams.
- **Flag**: none — resolved unflagged.

## G13 — Importer `configSchema` is not renderable — RESOLVED by spec 037

- **UX surface**: importer create/edit form scope section.
- **Need**: a serializable field descriptor (JSON Schema or field list) so
  scope controls render from the manifest instead of hardcoded per importer.
- **Resolution**: spec 036 shipped `configSchema` as draft-2020-12 JSON
  Schema (`z.toJSONSchema`) on `GET /importers` and
  `GET /importers/:name/schema`; spec 037 renders typed scope controls
  from it — text/URL inputs, enum dropdowns, boolean switches, string-list
  editors — with required markers, materialized defaults, a per-field
  JSON fallback for unrenderable shapes (e.g. `environmentMapping`), an
  "Unrecognized fields" block for stored keys outside the schema, and a
  lossless Edit-as-JSON toggle.
- **Flag**: none — resolved unflagged.

## G21 — List enrichment: component instances/lastSeen + importer lastRun — RESOLVED by spec 039

- **UX surface**: components list `Health` and `Last seen` columns
  (`componentListHealth`, `componentListLastSeen` flags — hidden until
  this lands); importer-card last-run summary.
- **Need**: per-row `worstStatus`/`lastSeenAt` rollup on `GET /components`
  (list payload currently omits `instances` and `lastSeenAt`). Importer
  `lastRun` is wired from `DashboardSummary.lastRuns` in spec 038 — this
  entry covers it only if that join proves insufficient.
- **Resolution**: RESOLVED by spec 039 — `worstStatus` + `lastSeenAt` rollups on `GET /components`; flags flipped ON.

## G22 — Team member counts — RESOLVED by spec 039

- **UX surface**: teams list `Members` column (`teamMemberCounts` flag —
  renders "—" fallback until this lands); LOB detail teams table.
- **Need**: `memberCount` on `GET /teams` (and LOB detail reads).
- **Resolution**: RESOLVED by spec 039 — `memberCount` + `componentCount` on `GET /teams`; flag flipped ON.

## G23 — Stat-grid deltas — RESOLVED by spec 040

- **UX surface**: dashboard stat-grid `+N this week` detail line
  (`statDeltas` flag — renders "—" hidden until this lands).
- **Need**: delta fields on `GET /dashboard` (week-over-week counts per
  stat card; "All healthy" for importers).
- **Resolution**: RESOLVED by spec 040 — `deltas.{products,components,
  instances}` on `GET /dashboard/summary` (trailing-7-day created counts
  scoped to each headline population); the importers card derives
  "All healthy"/"N need attention" from `importerIssues`, a
  pre-truncation count the summary emits (the attention array itself is
  capped at 20). Flag removed.

## G24 — Attention detail lines + CREDENTIAL_EXPIRING — RESOLVED by spec 040

- **UX surface**: attention-row `detail` sub-line (`attentionDetail` flag)
  and the `CREDENTIAL_EXPIRING` kind the card description already
  promises (`credentialExpiring` flag).
- **Need**: backend `detail` strings per attention row (e.g. "kubeconfig
  token expired", "Last heartbeat 2h ago · heartbeat_timeout") and a
  `CREDENTIAL_EXPIRING` kind emitted for `expiresAt`-near credentials.
- **Resolution**: RESOLVED by spec 040 — `AttentionItem.detail` composed
  server-side per kind; `CREDENTIAL_EXPIRING` emitted for ACTIVE
  credentials with `expiresAt` past or inside the 30-day window, ranked
  below OFFLINE_AGENT and above the sunset kinds (ADR-116 Amendment 4).
  Flags removed (fully wired).

## G25 — Agent "Enrolled by" — RESOLVED by spec 040

- **UX surface**: agent detail header (`agentEnrolledBy` flag — header
  shows "Created {date}" until this lands); pending-enrollment alert
  could regain `enrollmentExpiresAt` if the API exposes it.
- **Need**: `createdBy` (and optionally `enrollmentExpiresAt`) on
  `GET /agents/:id`.
- **Resolution**: RESOLVED by spec 040 — `createdBy` resolves
  `import_agents.createdBy` to `COALESCE(displayName, username)` at read
  time (null when unresolvable — never a raw id); `enrollmentExpiresAt`
  exposes the live pending token's expiry (gated on
  `revokedAt IS NULL` — a dead token shows no expiry). Flag removed.

## G26 — `includeGone` on component detail — DEFERRED (unscheduled)

- **UX surface**: component detail Instances card (`detailGoneInstances`
  flag). The detail read hard-filters `status != "GONE"`
  (`component-catalog-service.ts:216`) — no opt-in exists.
- **Deferred**: re-triaged after the enrichment specs; also decide the
  "kept for 30 days" retention copy once the param lands.

## G27 — Authentication hardening — DEFERRED (unscheduled)

- **UX surface**: `/settings/authentication` — "Allowed email domains"
  and "Password policy" sections (breached-password blocking,
  require-2FA-for-admins); `/register` work-email field.
- **Need**: settings storage + enforcement for domain allow-listing and
  password rules; `email` on `POST /auth/register`.
- **Deferred**: security batch; 2FA half overlaps G16.

## G28 — LOB owner field — DEFERRED (unscheduled)

- **UX surface**: LOB cards + LOB detail "Owner" row (v0 shows an
  owner avatar/name). The `LineOfBusiness` entity has no owner field.
- **Deferred**: org-entity batch; decide whether owner is a `Person`
  ref or free text.

## G29 — Manual component/group creation — RESOLVED by spec 042

- `POST /components` ships (spec 042): `createComponentSchema` in core
  (name, slug, category, provider, resourceType + optional
  teamOwnerId/componentGroupId/links/tags/sunsetAt — importer-managed
  columns rejected), `component:create` → EDITOR (ADR-054 Amendment 1),
  uuid v7, `409 SLUG_CONFLICT`, `component` `created` audit event.
- "Add manually" on `/components` opens `ComponentCreateDialog` (slug
  auto-derived, category/provider selects from `@componode/core` META,
  team/group selects, inline server errors) — lands on the new
  component's detail. "New group" on `/component-groups` opens
  `ComponentGroupCreateDialog` against the existing
  `POST /component-groups`. Both controls hidden below EDITOR;
  `manualEntityCreate` flag removed.

## G30 — "Keep me signed in" session-duration option — DEFERRED (unscheduled)

- **UX surface**: login form checkbox (v0 `login-form.tsx:94-99`).
- **Need**: per-session duration on `POST /auth/login` (session TTL
  override honored by the session service).
- **Deferred**: session-policy batch with G17.

## G31 — Edge-authoring UI — RESOLVED by spec 042

- Product detail's Dependencies tab gains a Relations card
  (`ux/components/products/edge-authoring.tsx`) driving the existing
  `useAddEdge`/`useRemoveEdge` hooks: kind select → target select
  (non-RETIRED products for composes, PLATFORM-only for consumes-from,
  components + component groups for depends-on), remove affordances per
  edge, `409 CYCLE` and other controlled errors surfaced with the server
  message via toast/inline error. Authoring controls hidden below
  EDITOR; the map canvas stays read-only (ADR-118).

## G32 — Suggestions decided-history — RESOLVED by spec 042

- `/suggestions` gains a Pending/History tab pair: History calls
  `useSuggestions("DECIDED")` — a new rolled-up status filter over every
  terminal state (`ACCEPTED`/`DISMISSED`/`SUPERSEDED`) ordered by
  `decidedAt` desc (ADR-113 spec-042 amendment). Rows show
  product/component links, a status badge, decided timestamp, and
  decider name; no accept/dismiss actions; empty state when none.
  `suggestionsHistory` flag removed.

## Conditional gaps — VERIFIED during implementation

- **Product bulk-import** — RESOLVED: `POST /products/bootstrap`
  (`?dryRun=true` preview) exists and is wired.
- **Component dependents** — RESOLVED: `GET /components/:id/dependents`
  exists and feeds the promote form.
