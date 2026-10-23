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

## G3 — Per-run change feed

- **UX surface**: run detail → changes tab (`/ux/importers/:id/runs/:runId`).
- **Need**: list of per-entity changes attributed to a run, or confirmation
  that the audit API can supply it (`?runId=`).
- **Current API**: no per-run change feed; audit has no `runId` filter today.
- **Flag**: `runChangeFeed`.

## G4 — Password reset

- **UX surface**: user detail → "Send password reset" (DangerZone-adjacent).
- **Need**: `POST /users/:id/password-reset` (admin-triggered reset email or
  one-time link).
- **Current API**: endpoint does not exist.
- **Flag**: `passwordReset` — action hidden.

## G5 — Expired-credential state rule

- **UX surface**: credentials list + detail; credential status chip.
- **Need**: a defined rule/state for credentials past `expiresAt` (currently
  the UI cannot distinguish expired from healthy).
- **Current API**: no expired state surfaced.
- **Flag**: `credentialExpiredState`.

## G6 — `credentialId` filter on `GET /importers`

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

## G10 — Audit `actor` filter param name

- **UX surface**: user detail → activity tab (`?actor=`).
- **Need**: confirm the audit list accepts an actor/user filter param and
  its name; otherwise the activity tab needs a different source.
- **Current API**: unconfirmed at spec time — verified during T034; if the
  param does not exist this becomes a new gap entry.

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

## Conditional gaps (flagged during implementation)

- **Product bulk-import endpoint** — `productBulkImport` flag; T022 verifies
  whether a bulk endpoint exists.
- **Component dependents endpoint** — `componentDependents` flag; T024
  verifies `GET /components/:slug/dependents` for the promote flow.
