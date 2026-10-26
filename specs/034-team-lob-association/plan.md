# Implementation Plan: Team ↔ LOB Association

**Branch**: `034-team-lob-association` | **Date**: 2026-10-26 | **Spec**: [spec.md](spec.md)

## Summary

Resolve ux-rewrite gap G12. `teams` gains an optional `lobId` FK to
`line_of_businesses` (migration 021, `ON DELETE SET NULL` + index), the
generic org service applies a team-specific Zod schema so `POST`/`PATCH
/teams` accept and validate the association (`lobId: uuid | null`), and
team read payloads embed a resolved `lob {id,name,slug}` summary — the
spec-033 server-side name-resolution precedent — so no client renders a
raw id. The product form's team picker groups by the product's selected
LOB (that LOB's teams first, all remaining teams in a separated "other"
group — clarified: grouping, not filtering; nothing hidden), the team
detail shows its LOB, and the LOB detail's placeholder "Teams" stat
becomes a live count plus a teams card (reverse read resolved
client-side from `useTeams()` — no new endpoint). The LOB delete guard
deliberately does not count `teams.lobId`: deleting a LOB clears the
association on its teams (set-null), matching spec FR-007. ADR-077 gains
an amendment for the new FK (the ADR's enumerated 1-to-many FK list was
presented as closed); `openapi.yaml` + regenerated `api.md` ship in the
same change (ADR-104).

## Technical Context

**Language/Version**: TypeScript 6, Node 24. **Dependencies**: existing —
Fastify, Kysely, Zod, TanStack Query, shadcn/ui. **Storage**: PostgreSQL —
one migration (`teams.lobId`). **Testing**: vitest (testcontainers backend
integration; frontend component/mapper unit). **Constraints**:
parameterized Kysely only (ADR-084); Zod strict at the boundary (ADR-095);
existing `team:create`/`team:update` permissions — no new permission
(ADR-097); GETs side-effect-free (ADR-094); openapi.yaml + api.md same
change (ADR-104); ADR fidelity — ADR-077 amendment for `teams.lobId`.

## Decisions (research)

- **D1 Column**: `teams.lobId uuid NULL → line_of_businesses(id) ON
  DELETE SET NULL` + index — the same ownership-FK shape as
  `digital_products.lobOwnerId`, `components.teamOwnerId`,
  `persons.teamId`. Single optional association per team (spec
  Assumptions).
  *Ratified in:* ADR-077 Amendment 1 — extends the ADR's enumerated
  1-to-many FK list, so the amendment ships in this change (AGENTS.md
  ADR fidelity).
- **D2 Write contract — team-specific schemas**: `createTeamSchema` /
  `updateTeamSchema` extend the shared org schema with
  `lobId: z.string().uuid().nullable().optional()`. `/lobs` keeps the
  base strict schema, so `lobId` on a LOB write is rejected as an
  unknown field (ADR-095) rather than silently accepted. Service:
  `createOrgEntity`/`updateOrgEntity` branch on `table === "teams"`;
  the referenced LOB must exist or `VALIDATION_FAILED` (400) — the code
  enum already covers it, no new error code. `lobId` lands in
  `entity_changes.changes` like other fields (FR-008, existing
  `writeEntityChange`).
- **D3 Read contract — embedded summary**: team list, detail, and
  mutation responses carry `lobId` plus `lob: {id,name,slug} | null`
  resolved by a left join — mirrors 033's server-resolved `entityName`
  decision (clients never resolve or render raw ids; renames flow
  through automatically). LOB payloads unchanged.
- **D4 LOB delete guard**: `teams.lobId` is *not* counted in
  `referenceCounts` — the FK's `ON DELETE SET NULL` clears the
  association, satisfying spec FR-007 ("teams remain, association
  cleared"). `digital_products.lobOwnerId` still blocks LOB deletion;
  that guard is ownership, this link is advisory.
- **D5 Reverse read — no new endpoint**: the LOB detail page derives its
  teams by filtering `useTeams()` on `lobId` — org lists are full,
  unpaginated reads, so a dedicated `/lobs/:id/teams` adds API surface
  for zero capability. (Symmetry candidate with `/teams/:id/members`
  only if a future paginated need appears.)
- **D6 Frontend surfaces**:
  - `OrgEntity` type gains `lobId`, `lob` (nullable summary).
  - `OrgFormDialog` gains a LOB `<Select>` rendered only for
    `noun === "team"` (lobs supplied by the caller); submit carries
    `lobId` or `null` on clear.
  - Team `index` table gains a *Line of business* column; team `$slug`
    stats gain *Line of business* (linked to `/lobs/:slug`).
  - LOB `$slug`: the `Teams` stat goes live and a teams card reuses the
    `OwnedTable` pattern with an empty state.
  - `product-form.tsx`: the team `<Select>` renders two `SelectGroup`s —
    the selected LOB's teams first, then every remaining team — plus
    `Unassigned`; the "Teams aren't linked to LOBs yet"
    `FieldDescription` is removed. With no LOB selected the list renders
    ungrouped. Nothing is hidden, so a mismatched current selection can
    never be silently cleared (spec clarification).
- **D7 Docs/registry**: `docs/openapi.yaml` + regenerated `docs/api.md`
  (ADR-104); `researches/ux-rewrite-gaps.md` G12 marked resolved;
  `docs/roadmap.md` shipped entry + Next revision.

## Constitution Check

I single-org ✓ (LOB is a domain entity, not a tenant) · II importer-first
✓ (no importer surface) · III taxonomy ✓ (canonical Team / Line of
Business terms; no new entity kind) · IV env-as-instance ✓ · V factual
layer ✓ (association is declared catalog data, not derived) · VI
test-first ✓ (failing integration tests for lobId write/read/delete
before impl) · VII observability ✓ (audit via existing entity_changes).
No violations — re-checked post-design, unchanged.

## Source touch-points

```text
packages/core/src/schemas/org.ts                       # + createTeamSchema / updateTeamSchema
packages/core/src/index.ts                             # export new schemas
packages/backend/src/db/migrations/021_team_lob.ts     # teams.lobId FK + index
packages/backend/src/db/types.ts (or generated types)  # teams.lobId column
packages/backend/src/services/org-service.ts           # team schema branch, lob join, lob-existence check
packages/backend/src/routes/org.ts                     # pass-through (schema selection in service)
packages/backend/test/integration/                     # lobId write/read/delete/set-null tests
packages/frontend/src/api/types.ts                     # OrgEntity += lobId, lob
packages/frontend/src/ux/components/org/org-form-dialog.tsx   # LOB select (team only)
packages/frontend/src/ux/components/org/org-detail.tsx        # LOB stat / teams card support
packages/frontend/src/ux/components/org/org-tables.tsx        # teams table LOB column
packages/frontend/src/ux/components/products/product-form.tsx # grouped team picker
packages/frontend/src/ux/app/{teams,lobs}/$slug.tsx           # wire lobId edit, teams list
packages/frontend/src/ux/app/teams/index.tsx                  # column wiring
docs/openapi.yaml · docs/api.md · researches/adrs/ADR-077 ·
researches/ux-rewrite-gaps.md · docs/roadmap.md
```
