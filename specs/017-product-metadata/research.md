# Research: Practical Catalog Metadata

Every design decision for this feature was ratified in
[ADR-111](../../researches/adrs/ADR-111-practical-catalog-metadata.md) during
the grilling session. This document records the codebase findings that
ground the implementation — no open NEEDS CLARIFICATION items remain.

## Decision: links as JSONB `{title, url}[]`

- **Rationale**: Display-only data; `components.details` already sets the
  jsonb precedent (migration 001). No joins needed on any read path.
- **Alternatives considered**: `entity_links` join table — rejected
  (ADR-111): CRUD and read cost for data nobody filters on.
- **Codebase**: `safeUrl()` helper exists at
  `packages/frontend/src/components/safe-url.ts` (used in
  `component-detail.tsx` for instance URLs) — reused for render-time
  re-validation per ADR-085; write-time validation is a Zod `url()` +
  protocol check in `packages/core`.

## Decision: tags as `text[]` + GIN

- **Rationale**: PostgreSQL arrays give `&&`/contains operators for the
  `?tag=` filter; GIN index keeps it index-backed. No join table needed for
  v1 (no tag CRUD/rename admin).
- **Alternatives considered**: `tags` + join tables — rejected (ADR-111).
- **Codebase**: first `text[]` column in the schema — Kysely supports
  `text[]` via `sql`type in the migration builder; normalization
  (lowercase/dedupe/charset) enforced in the shared Zod schema, not the DB.

## Decision: criticality enum via core constant + CHECK

- **Rationale**: matches the established enum pattern (ADR-079) —
  `PRODUCT_TYPES`/`COMPONENT_LIFECYCLE` constants flow into Zod enums and
  CHECK constraints, no native PG ENUMs.
- **Alternatives considered**: free text — rejected (ADR-111: filter and
  badges need a closed set); `TIER_1..4` naming — rejected (needs a legend).

## Decision: `sunsetAt timestamptz` nullable, display-only

- **Rationale**: date-only semantics evaluated client-side against today;
  badge thresholds (30d) are presentation logic, so no server-side computed
  column is needed — the API returns the raw date.
- **Alternatives considered**: auto-transition to RETIRED — rejected
  (ADR-111: a date informs, a person decides).

## Finding: component write surface is PATCH-only

`components` has no create route — `PATCH /components/:id` exists and is
currently scoped to `{componentGroupId, teamOwnerId}` via
`updateComponentGroupAssignmentSchema` → `component-group-service.ts`
`assignComponentGroup`. The plan extends this surface rather than adding a
route: a general `updateComponentSchema` accepts the curated fields
alongside the existing assignment fields, and the service generalizes to
`updateComponent` (keeping group-assignment behavior intact).

## Finding: importer writes are confined by construction

`import-run-service.ts` updates `components` via explicit
`.updateTable("components").set({...})` column lists — new columns cannot be
touched. FR-015 is satisfied structurally; a regression integration test
(curated fields survive an importer upsert) locks it in.

## Finding: list-query filter precedents

`listComponentsQuerySchema` already accepts multi-value filters
(`category`, `provider`, `lifecycle`) — `tag` joins as a single-value exact
match (spec assumption). `listProductsQuerySchema` is strict with `q`,
`type`, `lifecycle`, `includeRetired` — `tag` and `criticality` are added
the same way.

## Openapi/docs

ADR-104: `docs/openapi.yaml` updated in the same change;
`pnpm --filter @componode/backend docs:api` regenerates `docs/api.md`;
route coverage is enforced by a backend contract test.
