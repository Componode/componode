# Tasks: Team ↔ LOB Association

**Input**: `/specs/034-team-lob-association/` (spec, plan,
contracts/team-lob-association.md)

**Stories**: US1 product-form team grouping (P1) · US2 team records its
LOB + both-directions display (P2). Both depend on Phase 1 (the `lobId`
column, write validation, and embedded `lob` summary on team payloads).

## Phase 1: Foundational — `teams.lobId` contract

- [x] T001 Failing integration test `packages/backend/test/integration/team-lob.test.ts` (testcontainers + loginAs harness per existing org tests): `POST /teams` with a valid `lobId` → 201 and response carries `lobId` + `lob {id,name,slug}`; `GET /teams` and `GET /teams/:id` embed `lob`/`lobId` (null when unassociated); `PATCH` set → change → `null` clear; nonexistent `lobId` → `400 VALIDATION_FAILED`; `lobId` on `POST`/`PATCH /lobs` → `400 VALIDATION_FAILED` (strict schema); `DELETE /lobs/:id` with an associated team succeeds and the team's `lobId` reads `null` (set-null — LOB delete is NOT blocked by teams); `entity_changes` rows record `lobId` on write
- [x] T002 Migration `packages/backend/src/db/migrations/021_team_lob.ts`: `teams.lobId uuid NULL REFERENCES line_of_businesses(id) ON DELETE SET NULL` + `teams_lob_id_idx`; `TeamRow += lobId: string | null` in `packages/backend/src/db/types.ts`
- [x] T003 Team schemas in `packages/core/src/schemas/org.ts`: `createTeamSchema` / `updateTeamSchema` = base org schema + `lobId: z.string().uuid().nullable().optional()` (`.strict()` preserved); export from `packages/core/src/index.ts`
- [x] T004 `packages/backend/src/services/org-service.ts`: branch `table === "teams"` to parse with the team schemas; nonexistent `lobId` → `VALIDATION_FAILED`; team list/detail/mutation responses left-join `line_of_businesses` and embed `lob: {id,name,slug} | null`; `referenceCounts` unchanged — `teams.lobId` deliberately not counted (FK set-nulls per spec FR-007); green T001

## Phase 2: US1 — Product form groups teams by LOB

**Goal**: With a product LOB selected, the team picker leads with that
LOB's teams and keeps every remaining team reachable in a separated
group — nothing hidden; "Teams aren't linked to LOBs yet" notice removed.

**Independent Test**: two LOBs, teams across both + one unassociated —
select a LOB, picker leads with its teams, all others grouped below.

- [x] T005 [US1] Failing unit test `packages/frontend/src/test/unit/team-grouping.test.ts` for a pure `groupTeams(teams, lobId)` helper: selected LOB's teams first group, all remaining teams second group, `undefined`/unselected → single ungrouped list
- [x] T006 [US1] `groupTeams` helper + `packages/frontend/src/ux/components/products/product-form.tsx`: team `<Select>` renders `SelectGroup`/`SelectLabel` — selected LOB's teams, then "Other teams" containing all remaining teams (incl. unassociated); `Unassigned` stays; remove the "Teams aren't linked to LOBs yet" `FieldDescription`; no LOB selected → ungrouped list; green T005

## Phase 3: US2 — Teams record their LOB (both directions)

**Goal**: Admin assigns/changes/clears a team's LOB in the org dialog;
team detail shows its LOB (linked); LOB detail lists its teams.

**Independent Test**: create team with LOB → reads back on list/detail →
edit to another LOB → clear; LOB detail lists the team, then shows empty
state after clear.

- [x] T007 [US2] `OrgEntity += lobId: string | null; lob: {id,name,slug} | null` in `packages/frontend/src/api/types.ts`; `OrgEntityInput += lobId?: string | null` in `packages/frontend/src/api/hooks/org.ts`
- [x] T008 [US2] LOB `<Select>` in `packages/frontend/src/ux/components/org/org-form-dialog.tsx` rendered only when `noun === "team"` (lobs passed via prop — `useLobs()` at call sites); submit carries `lobId` (`null` to clear); edit initializes from `entity.lobId`
- [x] T009 [US2] `packages/frontend/src/ux/app/teams/index.tsx` + `packages/frontend/src/ux/components/org/org-tables.tsx`: teams table gains a *Line of business* column (`lob.name` linked to `/lobs/:slug`, `—` when null)
- [x] T010 [US2] `packages/frontend/src/ux/app/teams/$slug.tsx`: stats gain *Line of business* (linked, `Unassociated` when null); edit dialog submit passes `lobId`
- [x] T011 [US2] `packages/frontend/src/ux/app/lobs/$slug.tsx` + `org-detail.tsx`: live *Teams* stat (count of `useTeams()` filtered by `lobId`) + teams card reusing the `OwnedTable` pattern with `No associated teams` empty state

## Phase 4: Docs + gate

- [x] T012 `docs/openapi.yaml`: `lobId` write field on team POST/PATCH schemas, `lobId` + `lob` summary on team response schemas, `400 VALIDATION_FAILED` documented; `pnpm docs:api`; route-coverage contract test green
- [x] T013 ADR-077 Amendment 1 — `teams.lobId` added to the enumerated 1-to-many FK list (ON DELETE SET NULL; not counted in the LOB delete guard); `researches/architecture-decisions.md` amends list updated if ADR-077 is tracked there
- [x] T014 `researches/ux-rewrite-gaps.md`: G12 → Resolved by spec 034 (note the group-not-filter clarification + both-directions display); `docs/roadmap.md`: `034` shipped bullet + Next queue drops 034
- [x] T015 `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green

## Dependencies & parallel

- Phase 1 blocks both stories (team payloads must carry `lobId`/`lob`).
- T001 before T002–T004 (test-first); T005 before T006.
- US1 (frontend picker) and US2 (org surfaces) touch disjoint frontend
  files — can run in parallel after Phase 1.
- T007 precedes T008–T011 (shared types).
- MVP = Phase 1 + Phase 2 (the user-facing picker change).

## Implementation notes

- LOB delete: teams survive with `lobId` set null (FR-007) — do NOT add
  `teams.lobId` to `referenceCounts`.
- The association is advisory: no consistency check between a product's
  `lobOwnerId` and its `teamOwnerId`'s LOB (spec Edge Cases).
- Error codes: reuse `VALIDATION_FAILED`/`NOT_FOUND` — no new enum
  (ADR-071).

## Phase 5: Convergence

- [x] T016 Update the hand-written note in `docs/api.md` claiming `/lobs` and `/teams` share an identical `{name, slug?, description?}` body — teams now also accept `lobId` (uuid|null, must reference an existing LOB) while LOBs still reject it per FR-009 (partial)
- [x] T017 Guard the "Other teams" `SelectGroup` in `packages/frontend/src/ux/components/products/product-form.tsx` on `others.length > 0` so an empty group label never renders per FR-005 (partial)

## Phase 6: Review

- [x] T018 On LOB delete, explicitly clear affected teams inside the same transaction — `teams.lobId = null` + `updatedAt` bump + one `writeEntityChange` (action `updated`, changes `{lobId: null}`) per team in `deleteOrgEntity` (`packages/backend/src/services/org-service.ts`); keep the FK `ON DELETE SET NULL` as the safety net; extend `team-lob.test.ts` to assert the per-team audit row (code-review: spec — FR-008; code-review: standards — HIGH)
- [x] T019 Flatten `CreateTeam`/`UpdateTeam` in `docs/openapi.yaml` into single objects declaring `name`/`slug`/`description`/`lobId` — `allOf` + `additionalProperties: false` is unsatisfiable under OpenAPI 3.0 (code-review: standards — HIGH)
- [x] T020 Move org write validation to the route boundary per ADR-095: select `createTeamSchema`/`updateTeamSchema` vs the base schemas per table in `packages/backend/src/routes/org.ts` `register()`, `safeParse` the body → `400 VALIDATION_FAILED`, pass parsed input into `createOrgEntity`/`updateOrgEntity` (drop the redundant in-service `.parse`) (code-review: standards — MEDIUM)
- [x] T021 Invalidate `["teams"]` on LOB update/delete mutations in `packages/frontend/src/api/hooks/org.ts` — embedded `team.lob` goes stale on rename/delete (code-review: standards — MEDIUM)
- [x] T022 Split team-only fields off the shared types: `TeamEntity extends OrgEntity` (required `lobId`/`lob`) and `TeamEntityInput` (+`lobId`) in `packages/frontend/src/api/types.ts`/`hooks/org.ts`; type the teams hooks with them so LOB mutations statically reject `lobId` (code-review: standards — LOW)
- [x] T023 Add `required: [id, name, slug]` to the `lob` summary object in `docs/openapi.yaml` (code-review: spec — LOW)
- [x] T024 Justify `LobsGrid` Teams-count scope extension — ACCEPTED: rides the clarified "both directions" scope (LOB detail lists its teams); a count on the index grid is the same derived read, no new contract surface (LobsGrid card in `org-tables.tsx` + `lobs/index.tsx`) — accepted: within the clarified both-directions scope; note in spec Assumptions? Keep code as-is; document the acceptance in tasks.md or spec (code-review: spec — LOW)

## Phase 7: Review (round 2)

- [x] T025 Move `detailParamsSchema` declaration below the import block in `packages/backend/src/routes/org.ts` (code-review: standards — LOW)
- [x] T026 Gate LOB detail `associatedTeams` card + `Teams` stat and `LobsGrid` teams count on `useTeams()` having resolved — empty state no longer conflates "none" with "not loaded" (code-review: spec — LOW)
- ACCEPTED (no change): `assertLobExists` TOCTOU matches the existing `assertUniqueSlug` pattern — a raced LOB delete yields an FK error, consistent house style (code-review: standards — LOW, judgment call)
- ACCEPTED (no change): `Team` schema omits `required` like sibling `LineOfBusiness` — entity response schemas don't declare required in this file (code-review: spec — LOW, judgment call)
