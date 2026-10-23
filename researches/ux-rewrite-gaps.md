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

## G1 — Per-day importer run aggregates

- **UX surface**: importer detail → history chart (`/ux/importers/:id`).
- **Need**: counts of runs per day (created/updated/failed) over a window.
- **Current API**: `GET /import-runs?importerId=` returns runs; no aggregate
  endpoint. Client-side aggregation over the full run list does not scale.
- **Flag**: `historyAggregates` — chart hidden until resolved.

## G2 — Session device / location / owning user

- **UX surface**: `/ux/sessions` columns and `/ux/users/:id` sessions tab.
- **Need**: `device` (user-agent parse), `location`, and the owning `userId`
  on the admin sessions list.
- **Current API**: session records carry none of these; the sessions list is
  scoped to the caller.
- **Flags**: `sessionDevice`, `sessionLocation`, `sessionOwner`.

## G3 — Per-run change feed — RESOLVED (verified T036)

- `GET /importer-configs/:id/runs/:runId/changes` exists and the run-detail
  changes tab wires `useRunChanges`. No flag needed; entry retained for
  audit trail.

## G4 — Password reset — PARTIAL

- **Verified**: `POST /auth/password/reset` (admin) returns a reset token;
  `POST /auth/password/reset/confirm` is public. There is no email delivery —
  the admin copies the link and delivers it out-of-band. The UX wires the
  token-generation call and shows the link for copy-out; an email-delivery
  workflow remains deferred.
- **Flag**: `passwordReset` ON (token flow); email delivery would be a new gap.

## G14 — Self-service profile update

- **UX surface**: `/ux/settings/profile` — display name/email editing.
- **Need**: `PATCH /users/me` for non-admins; today `PATCH /users/:id`
  requires `user:update` (ADMIN) so non-admins get 403 on save.

## G15 — Notification preferences

- **UX surface**: `/ux/settings/notifications` — event × channel matrix.
- **Need**: per-user notification prefs endpoint (none exists). Matrix
  renders disabled behind `notifications` flag.

## G16 — Two-factor authentication

- **UX surface**: `/ux/settings/security` — TOTP toggle. No backend. Hidden
  behind `twoFactor`.

## G17 — Session concurrency controls

- **UX surface**: `/ux/settings/session-policy` — one-session-per-user and
  IP-binding toggles. `AppSettings` only carries the two timeouts; hidden
  behind `sessionConcurrency`.

## G18 — Workspace profile fields

- **UX surface**: `/ux/settings/workspace` — workspace name/URL/regional
  defaults. `AppSettings` has no such fields; hidden behind `workspaceProfile`.

## G19 — Retention + export operations

- **UX surface**: `/ux/settings/advanced` — gone-instance retention window,
  catalog export, destructive reset. No endpoints; hidden behind
  `advancedOps`.

## G20 — Client display preferences

- **UX surface**: `/ux/settings/appearance` — density, reduce-motion,
  relative-time toggles. Persisted to `localStorage` (`ux.prefs`) but no
  component consumes them yet; flagged `displayPrefs`.

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
- **Flag**: `credentialUsageFilter`.

## G7 — Team detail endpoint

- **Status**: partially resolved during implementation — `PATCH /teams/:id`
  and `DELETE /teams/:id` exist (verified in `src/routes/org.ts`).
- **UX surface**: `/ux/teams/:slug` detail page.
- **Need**: `GET /teams/:id`. Until it lands, detail resolves via the
  filtered-list strategy (fetch list, match slug) — see
  `contracts/wiring.md`. `GET /teams/:id/members` already exists.
- **Flag**: none.

## G8 — LOB detail endpoint

- **Status**: partially resolved during implementation — `PATCH`/`DELETE
  /lobs/:id` exist.
- **UX surface**: `/ux/lobs/:slug` detail page.
- **Need**: `GET /lobs/:id`; detail resolves via filtered-list meanwhile.
- **Flag**: none.

## G9 — Component-group slug lookup

- **UX surface**: `/ux/component-groups/:slug`.
- **Need**: groups addressed by slug, or a documented client-side slug→id
  resolution (prototype routes use slugs; API addresses groups by id).
- **Current API**: group endpoints take `:id`. Resolution strategy per
  `contracts/wiring.md`: list + match, or a `?slug=` filter if added.
- **Flag**: none — handled by read-hook resolution; recorded here as a
  candidate API addition.

## G10 — Audit `actor` filter — RESOLVED (verified T034)

- **UX surface**: user detail → activity tab (`?actor=`).
- **Verified**: `activityFeedQuerySchema` accepts `actor`, and
  `audit-query-service.ts` matches it against `createdByName`/`createdBy`.
  The user detail activity tab wires `useActivityFeed({ actor: username })`.
  No gap — entry retained for audit trail only.

## G11 — Audit feed entity display names

- **UX surface**: dashboard recent activity, `/ux/activity`, entity-history
  tabs — the feed renders `<entityName>` per row.
- **Need**: `ActivityFeedItem`/`EntityChange` carry `entityId` but no display
  name or human summary; the UI must render `entityType:entityId` pairs.
- **Current API**: no `entityName`/`summary` field on audit feed items.
- **Flag**: none — mapper degrades gracefully; recorded as a candidate API
  addition.

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
