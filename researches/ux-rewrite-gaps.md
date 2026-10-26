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
6. `035` — schema-driven importer forms (G13)

Deferred past this program — re-triaged after it closes: G15 (merged
with the email-delivery half of G4), G16, G17, G18, G19. G20 resolves
client-side without a spec.

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
  `profileSelfEdit` is ON and the read-only fallback removed.

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

## G20 — Client display preferences

- **UX surface**: `/ux/settings/appearance` — density, reduce-motion,
  relative-time toggles. Persisted to `localStorage` (`ux.prefs`) but no
  component consumes them yet; flagged `displayPrefs`.
- **Resolution**: client-side only — consume the persisted prefs
  app-wide, flip the flag, mark resolved. No backend, no spec; ships as
  a small standalone change.

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

## G12 — Team ↔ LOB association

- **UX surface**: product form filters teams by selected LOB; team detail
  shows its LOB.
- **Need**: a `lobId` on teams (or a membership/ownership link). The
  `teams` table has no LOB column today.
- **Flag**: none — the form shows all teams unfiltered until resolved.

## G13 — Importer `configSchema` is not renderable

- **UX surface**: importer create/edit form scope section.
- **Need**: a serializable field descriptor (JSON Schema or field list) so
  scope controls render from the manifest instead of hardcoded per importer.
- **Current API**: `GET /importers` returns the zod schema object itself,
  which serializes to `{}` — no usable shape reaches the client. The form
  uses a validated JSON scope editor until the API exposes descriptors.
- **Flag**: none — the JSON scope editor IS the shipped state (flag removed;
  a future schema-driven form would flip a new flag on this entry).

## Conditional gaps — VERIFIED during implementation

- **Product bulk-import** — RESOLVED: `POST /products/bootstrap`
  (`?dryRun=true` preview) exists and is wired.
- **Component dependents** — RESOLVED: `GET /components/:id/dependents`
  exists and feeds the promote form.
