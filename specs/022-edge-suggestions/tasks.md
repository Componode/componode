---

description: "Task list for 022-edge-suggestions implementation"

---

# Tasks: Edge Suggestions

**Input**: Design documents from `/specs/022-edge-suggestions/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: Included — constitution VI (test-first). Every story's tests are
written and confirmed failing before its implementation tasks.

**Organization**: Foundational lands the `edge_suggestions` table + core
contracts. US1 (queue CRUD) is testable over fixture-seeded rows and needs
no generation; US2 (generation + tombstones) needs no UI; they are
independently shippable in tests but only deliver real value together —
see Implementation Strategy. US3 extends US1's queue page and read path.

## Phase 1: Setup

- [X] T001 Confirm green baseline on `feature/022-edge-suggestions`: `pnpm install && pnpm lint && pnpm typecheck && pnpm --filter @componode/backend vitest run test/integration/products.test.ts test/integration/component-groups.test.ts`

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The `edge_suggestions` table, its core constants/contracts,
and the Zod boundary schema both stories consume. No story work can begin
until this phase is complete.

- [X] T002 [P] Add suggestion constants in `packages/core/src/constants/edge-suggestion.ts` — `EDGE_SUGGESTION_REASON = ["NAME_MATCH", "TOPIC_TAG_MATCH", "NAMESPACE_MATCH"]` and `EDGE_SUGGESTION_STATUS = ["PENDING", "ACCEPTED", "DISMISSED", "SUPERSEDED"]` each `as const` with `type` + `*_META` records (label/description per existing constant files); export via `packages/core/src/constants/index.ts`
- [X] T003 [P] Add suggestion contracts in `packages/core/src/contracts/edge-suggestion.ts` — `EdgeSuggestion {id, productId, componentId, reason: EdgeSuggestionReason|null, score: number|null, status, createdAt, decidedAt, decidedBy}`, `SuggestionQueueItem extends EdgeSuggestion {product:{id,name,slug}, component:{id,name,slug,category}, decidedByName: string|null}`, `SuggestionListResult {items, total}`, `SuggestionRescanReport {productsScanned, componentsScanned, staged, superseded}`; export via `packages/core/src/index.ts`
- [X] T004 [P] Add `listSuggestionsQuerySchema` in `packages/core/src/schemas/suggestions.ts` — strict object: `status` optional enum `PENDING|DISMISSED` default `PENDING`, `limit` int default `50` max `200`, `offset` int default `0` (ADR-095); export via `packages/core/src/schemas/index.ts` and `packages/core/src/index.ts`
- [X] T005 Create migration `packages/backend/src/db/migrations/014_edge_suggestions.ts` — `edge_suggestions` table: `id uuid PK`, `productId uuid NOT NULL REFERENCES digital_products ON DELETE CASCADE`, `componentId uuid NOT NULL REFERENCES components ON DELETE CASCADE`, `reason text NULL` + `checkConstraint("reason", EDGE_SUGGESTION_REASON)` (NULL allowed — coverage tombstones), `score integer NULL` (basis points), `status text NOT NULL DEFAULT 'PENDING'` + `checkConstraint("status", EDGE_SUGGESTION_STATUS)` (import constants from `@componode/core`, not literals — needs T002), `createdAt timestamptz NOT NULL DEFAULT now()`, `decidedAt timestamptz NULL`, `decidedBy uuid NULL REFERENCES persons ON DELETE SET NULL`; `UNIQUE (productId, componentId)`; indexes `(status, score DESC)` and `(componentId)`; `down()` drops the table. Migrations auto-discovered by filename
- [X] T006 [P] Add `EdgeSuggestionRow` to `packages/backend/src/db/types.ts` (matching T005 columns; `score: number | null`, `reason: string | null`, `status: string`, `decidedAt: string | null`, `decidedBy: string | null`, `createdAt: Generated<string>`) and `edge_suggestions: EdgeSuggestionRow` on the `DB` interface

**Checkpoint**: `pnpm typecheck` green; migration applies and rolls back
cleanly; core exports resolve — both stories can begin.

## Phase 3: User Story 1 — Review and decide suggested dependencies (Priority: P1) 🎯 MVP

**Goal**: `GET /suggestions` queue (pending sorted by score, embedded
product/component refs, RETIRED-endpoint exclusion) + `POST
/suggestions/{id}/accept` (real edge via `addDependsOnEdge` + `ACCEPTED`)
+ `POST /suggestions/{id}/dismiss` (permanent `DISMISSED`) + the
`/suggestions` page.

**Independent Test**: seed `edge_suggestions` rows directly in fixtures —
`GET` lists them score-desc; accept → real `DEPENDS_ON` edge + audit row +
row `ACCEPTED`; dismiss → `DISMISSED` with decider/timestamp; repeat
rescan-free — decided rows never resurface. Delivers full queue value with
zero generation.

### Tests for User Story 1 (write first, confirm FAIL)

- [X] T007 [P] [US1] Integration tests in `packages/backend/test/integration/edge-suggestions.test.ts` — fixture-seeded rows: `GET /suggestions` returns score-DESC items with `product`/`component` refs; rows whose product or component is `RETIRED` excluded; `status=DISMISSED` view; bad params → `400`; unauthenticated → `401`; accept → `200` + real edge in `product_depends_on_component` + `edge_changes` audit attributed to actor + row `ACCEPTED` with `decidedAt`/`decidedBy`; accept already-wired pair → no duplicate edge, terminal state; accept non-`PENDING` → `409 CONFLICT`; accept missing id / gone component → `404 NOT_FOUND`, row stays `PENDING`, nothing partial; dismiss → `DISMISSED` + `decidedAt`/`decidedBy`; dismiss non-`PENDING` → `409`; VIEWER accept/dismiss → `403` (US1/AC1–AC6, FR-008–FR-012)
- [X] T008 [P] [US1] Frontend unit tests in `packages/frontend/src/test/unit/suggestions.test.tsx` — page renders pending rows score-desc with product/component links and natural-language reason chips (`Name match`/`Topic tag match`/`Namespace match`, never enum names); score shown; Accept/Dismiss visible for EDITOR+, hidden for VIEWER; dismiss opens a confirm dialog; empty state per state matrix; loading skeleton + error state

### Implementation for User Story 1

- [X] T009 [US1] Create `packages/backend/src/services/edge-suggestion-service.ts` — `listSuggestions(query)` (join `digital_products` + `components` for refs, `leftJoin persons` for `decidedByName`; `PENDING` view excludes rows where either endpoint `lifecycle='RETIRED'`, orders `score DESC, createdAt ASC, id`, offset pagination; `DISMISSED` view orders `decidedAt DESC`, no lifecycle filter); `acceptSuggestion(id, actor)` (row missing → `404 NOT_FOUND`; `status!=='PENDING'` → `409 CONFLICT`; call `addDependsOnEdge(productId, {componentId}, actor)` letting its errors propagate — row untouched on throw; then `UPDATE ... SET status='ACCEPTED', decidedAt=now(), decidedBy=actor.id WHERE id AND status='PENDING'`); `dismissSuggestion(id, actor)` (same 404/409 guards; `UPDATE ... SET status='DISMISSED', decidedAt, decidedBy WHERE id AND status='PENDING'`)
- [X] T010 [US1] Create `packages/backend/src/routes/suggestions.ts` and register in `packages/backend/src/app.ts` — `GET /suggestions` (`verifySession` only — any authenticated role), `POST /suggestions/:id/accept` and `POST /suggestions/:id/dismiss` (`verifySession` + `requireRole("product:edge:add")`); Zod-strict query parsing via `listSuggestionsQuerySchema`
- [X] T011 [P] [US1] Add suggestion types to `packages/frontend/src/api/types.ts` and create `packages/frontend/src/api/hooks/suggestions.ts` — `useSuggestions(status)`, `useAcceptSuggestion()` (invalidates `["suggestions"]` + the product's detail/dependency queries), `useDismissSuggestion()` (invalidates `["suggestions"]`)
- [X] T012 [US1] Create `packages/frontend/src/pages/suggestions.tsx` — list-page anatomy: header (`Pending suggestions`, count), rows (product link, "depends on", component link + category badge, reason chip, score), per-row Accept/Dismiss gated on `canEdit` (EDITOR/ADMIN via `useSession`), dismiss behind confirm dialog (destructive per ux.md §7), skeleton/empty/error states per state matrix
- [X] T013 [P] [US1] Register `/suggestions` route in `packages/frontend/src/routes.tsx` and add the `Suggestions` nav item under the Catalog section in `packages/frontend/src/components/layout/nav-sections.ts` (below Component Groups)

**Checkpoint**: `edge-suggestions.test.ts` + `suggestions.test.tsx` green —
the full review/decide loop works over seeded candidates.

## Phase 4: User Story 2 — Candidates stage themselves as the catalog evolves (Priority: P2)

**Goal**: the signal engine + merge pass (`generateSuggestions` scoped by
`{productId}`/`{componentIds}`/`{all}`), `SUPERSEDED` tombstones on every
`DEPENDS_ON` write, trigger hooks (run-complete, product create/rename,
component rename/group move), and `POST /suggestions/rescan` + UI button.

**Independent Test**: import a name-overlapping component → pending
candidate appears post-run; wire a pair manually → its pending row goes
`SUPERSEDED`; delete that edge → pair never regenerates; `POST
/suggestions/rescan` → report counts; second rescan → `staged: 0`. Works
without any UI.

### Tests for User Story 2 (write first, confirm FAIL)

- [X] T014 [P] [US2] Unit tests in `packages/backend/test/unit/suggestion-signals.test.ts` — `tokenize` (lowercase, `[^a-z0-9]+` split, drops `<2`-char tokens and stop-words `api|svc|service|app|the|and|for|com|org|net|io|dev`); `NAME_MATCH` 1.0 on token-set containment / 0.5 on shared token; `TOPIC_TAG_MATCH` 0.5 first overlap +0.1 each extra cap 0.8 (product `tags`+name tokens vs component `tags`+`details.topics`); `NAMESPACE_MATCH` 0.6 on `details.namespace` token overlap; multi-signal `+0.05` each cap `+0.1`, reason = strongest; floor `<0.5` not staged (research.md D3)
- [X] T015 [P] [US2] Integration tests in `packages/backend/test/integration/edge-suggestion-generation.test.ts` — successful import-run completion stages candidates for new/changed components (US2/AC1); product create/rename regenerates that product's pairs (AC2); manual component rename enters pool (AC3); decided rows (`ACCEPTED`/`DISMISSED`/`SUPERSEDED`) never return to `PENDING` across passes (AC4); manually wired pair → `SUPERSEDED` incl. between-pass race (AC5); group-covered pair suppressed — direct member and member-added-later cases (AC6); deleted edge never regenerates (AC7); `POST /suggestions/rescan` returns `{productsScanned, componentsScanned, staged, superseded}` and is idempotent (AC8); failed/cancelled run stages nothing; `RETIRED` endpoints never staged; pending row rescore on rename keeps status (US2 ACs, FR-002–FR-007)

### Implementation for User Story 2

- [X] T016 [US2] Add the generation engine to `packages/backend/src/services/edge-suggestion-service.ts` — `tokenize`, per-signal scorers, `scorePair` (reason = strongest signal, score = best + multi-signal bonus, floor 0.5), and `generateSuggestions(scope: {productId?} | {componentIds?} | {all})`: load active products + in-scope active components + both dep junctions + existing rows; apply in order — covered pairs → `SUPERSEDED` tombstone upsert (`reason/score` NULL, `decidedAt=now()`, `decidedBy` = wiring actor or NULL), signal hits → `INSERT ... ON CONFLICT (productId, componentId) DO UPDATE SET reason, score WHERE status='PENDING'`; return `SuggestionRescanReport`-shaped counts; emit a structured log + duration/staged/superseded metrics per pass
- [X] T017 [US2] Tombstone upsert in `packages/backend/src/services/product-edge-service.ts` `addDependsOnEdge` — after a successful edge insert (inside the same transaction), upsert `edge_suggestions` rows for the wired pair(s) → `SUPERSEDED` with `decidedAt=now()`, `decidedBy=actor.id`, `reason/score` NULL: single `componentId` (1 row), `componentIds[]` (one per id), `componentGroupId` (one per current member `componentId` from `components.componentGroupId`); `removeDependsOnEdge` unchanged — tombstones persist (deleted edges never regenerate)
- [X] T018 [P] [US2] Run-complete trigger in `packages/backend/src/services/import-run-service.ts` `worker()` — after `updateRun(...COMPLETED)` (not on `FAILED`/`CANCELLED`), await `generateSuggestions({componentIds: [...yieldedComponentIds]})` inside try/catch → structured log + metric on error, never rethrow (a suggestion bug must not flip a run)
- [X] T019 [P] [US2] Product triggers in `packages/backend/src/services/product-service.ts` — `createProduct`: post-commit `generateSuggestions({productId})`; `updateProduct`: same only when `name` (or `slug`-affecting field) changed; both failure-isolated (try/catch → log, never reject the write)
- [X] T020 [P] [US2] Component triggers in `packages/backend/src/services/component-group-service.ts` `updateComponent` — on `name` change → `generateSuggestions({componentIds: [id]})`; on `componentGroupId` change → coverage re-evaluation tombstoning newly covered `(product depending on new group, component)` pairs; failure-isolated
- [X] T021 [US2] Add `POST /suggestions/rescan` to `packages/backend/src/routes/suggestions.ts` — `verifySession` + `requireRole("product:edge:add")`, synchronous `generateSuggestions({all})`, `200` with `SuggestionRescanReport` (needs T016 + T010)
- [X] T022 [US2] Rescan affordance on `packages/frontend/src/pages/suggestions.tsx` — `Rescan` header action visible to `canEdit`, calls `useRescanSuggestions()` (new mutation in `packages/frontend/src/api/hooks/suggestions.ts` invalidating `["suggestions"]`), toast/report the returned counts (serialize after T012 — same file)

**Checkpoint**: `edge-suggestion-generation.test.ts` +
`suggestion-signals.test.ts` green — candidates stage on every trigger and
terminal states hold under repeated passes.

## Phase 5: User Story 3 — Inspect and explain past decisions (Priority: P3)

**Goal**: the dismissed view surfaces reason, score, decider name, and
decision time; accepts are attributable through normal edge audit.

**Independent Test**: accept one row + dismiss another → `status=DISMISSED`
view lists the dismissed pair with decider name + relative time; the
accepted edge's audit entry names the accepter.

### Tests for User Story 3 (write first, confirm FAIL)

- [X] T023 [P] [US3] Extend `packages/backend/test/integration/edge-suggestions.test.ts` — `status=DISMISSED` items carry `decidedByName` (persons join), `decidedAt` DESC ordering, `reason`/`score` preserved; accepted edge's `edge_changes` row attributes the accepter (US3/AC1–AC3)
- [X] T024 [P] [US3] Extend `packages/frontend/src/test/unit/suggestions.test.tsx` — status filter switches the query; dismissed rows render reason chip + score + "dismissed by {name} {relative time}"; terminal rows render no action buttons

### Implementation for User Story 3

- [X] T025 [US3] Status filter + dismissed rendering on `packages/frontend/src/pages/suggestions.tsx` — Pending/Dismissed select bound to the `status` query param (URL-filter convention), dismissed rows show reason chip, score, decider name, and relative `decidedAt` (absolute ISO on hover); no per-row actions on terminal rows (needs T012)

**Checkpoint**: history is inspectable end-to-end; every decision
attributable.

## Phase 6: Polish & Cross-Cutting

- [X] T026 Update `docs/openapi.yaml` — `GET /suggestions` (+ query params, `verifySession`-only), `POST /suggestions/{id}/accept` + `/dismiss` + `/rescan` (`x-permission: product:edge:add`), request/response schemas per `contracts/api.md`; run `pnpm --filter @componode/backend docs:api` to regenerate `docs/api.md`; `test/unit/api-docs-contract.test.ts` must pass (ADR-104)
- [X] T027 [P] Update `docs/digital-products.md` — candidate-edge lifecycle (PENDING→ACCEPTED/DISMISSED/SUPERSEDED), the three signals, suppression rules, queue walkthrough; verify `CONTEXT.md` "Candidate edge" entry still accurate; add one line under AGENTS.md "Graph & hierarchy" noting server-generated staged candidates exist (ADR-113)
- [X] T028 [P] Add changeset `.changeset/edge-suggestions-022.md` — minor bumps `@componode/core`, `@componode/backend`, `@componode/frontend`
- [X] T029 Full gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`; walk every `quickstart.md` scenario (post-run staging, accept/dismiss, rescan idempotency, VIEWER read-only, group coverage, deleted-edge no-regenerate, dismissed inspection); verify no `sql.raw()` in new code (ADR-084) and error shapes leak nothing (ADR-096)
- [X] T030 Update `docs/roadmap.md` — move `022-edge-suggestions` to Shipped; revise the Next list (`023-coverage-and-hygiene` heads the queue)

## Dependencies

```text
Phase 1 (Setup) → Phase 2 (Foundational) → {US1, US2} → US3 → Phase 6 (Polish)

Foundational:  T002 must land before T005 (migration CHECKs import core
               constants); T003/T004/T006 parallel alongside
US1 (queue):   independent — tests seed suggestion rows directly, no
               generation needed; T009 → T010 (service → routes);
               T011 → T012 → T022 (same page file, serialize)
US2 (gen):     independent — no UI required to verify; T016 blocks T021
               (rescan needs the engine) and feeds T017–T020 triggers;
               T022 also needs T012's page
US3 (history): depends on US1's page + read path (T012, T009 join)
Polish:        after all stories
```

## Parallel Execution

- **Foundational**: T002 ∥ T003 ∥ T004 ∥ T006 (four different files); T005 after T002
- **US1**: T007 ∥ T008 (test files); T009 → T010; T011 ∥ T013 (hooks vs nav/routes) once service contract is known; T012 after T011
- **US2**: T014 ∥ T015 (test files); T016 → {T017, T018, T019, T020, T021} (engine first, then five different files in parallel); T022 after T012 + T016
- **US3**: T023 ∥ T024 (test additions); T025 after T012

## Implementation Strategy

**MVP**: Phase 1 + 2 + US1 + US2 **together** — US1 alone ships an
always-empty queue (nothing stages candidates) and US2 alone ships an
invisible staging engine; the pair is the minimum loop that delivers value.
US1 is still built and tested independently (fixture-seeded rows) so the
queue CRUD is verifiable before generation exists.

**Increment 2**: US3 — history/decision inspection on the working queue.

**Increment 3**: Polish — OpenAPI contract, docs, changeset, gate, roadmap.

**Test-first discipline**: every story's test task precedes implementation
and must be observed failing first — `404` on `/suggestions` routes (US1),
no `edge_suggestions` rows staged (US2), missing `decidedByName`/filter
(US3) — before coding the story.

## Phase 7: Convergence

- [X] T031 Close the tombstone gap on edge-write paths that bypass `addDependsOnEdge` — `catalog-bootstrap-service.ts` (line ~461 apply loop) and `platform-promotion-service.ts` (line ~296 platform edge) insert `product_depends_on_component` directly, so a pair wired then removed before any generation pass can regenerate as `PENDING`. Run a scoped generation pass (or `supersedeSuggestionPairs` equivalent) after bootstrap apply and promotion so wired pairs are tombstoned immediately per FR-006 + edge case "deliberately unwired stays unwired" (partial)
- [X] T032 Trigger product-scoped generation for products created/renamed outside `createProduct`/`updateProduct` — catalog bootstrap upserts (`catalog-bootstrap-service.ts` insert + `plan.updates` paths, including renames) and platform promotion (`platform-promotion-service.ts` line ~265 product insert) currently stage no candidates until an unrelated trigger fires per FR-002 (partial)
- [X] T033 Make accept land `SUPERSEDED` when the pair is already wired — `acceptSuggestion` marks `ACCEPTED` before calling `addDependsOnEdge`, whose `onConflict(doNothing())` silently no-ops on an existing edge; the record should end `SUPERSEDED` (no edge was created by the accept) per FR-010 + edge case "pair wired while pending" (partial)

## Phase 8: Review follow-ups

Two-axis review (`git diff HEAD` vs working tree) findings; apply and re-verify.

- [X] T034 Fix frontend suggestion types — `packages/frontend/src/api/types.ts` hand-copies `SuggestionQueueItem`/`SuggestionListResult`/`SuggestionRescanReport` instead of re-exporting `@componode/core` (ADR-065 convention, like `BootstrapReport`), and `hooks/suggestions.ts` types accept/dismiss responses as `SuggestionQueueItem` while the API returns bare `EdgeSuggestion`
- [X] T035 Align accept with the contract — `acceptSuggestion` returns 200 for `ACCEPTED` rows but `contracts/api.md` requires 409 for any non-`PENDING` row; drop the idempotent early-return. Also made the already-wired check race-safe: `addDependsOnEdge` now returns `{created}` from its `ON CONFLICT` insert (which blocks on a concurrent uncommitted wire), replacing the pre-check SELECT
- [X] T036 Tombstone consumer pairs deleted by promotion — `platform-promotion-service.ts` deletes consumer `DEPENDS_ON` edges directly; a pair wired before this feature and deleted by promotion could regenerate (FR-006). Call `supersedeSuggestionPairs` per deleted consumer edge
- [X] T037 Collapse the five pasted `try { generateSuggestions } catch { appLogger.error }` trigger blocks into a shared failure-isolated `runSuggestionPass(scope, context)` in `edge-suggestion-service.ts` (+ `suggestion_pass_errors_total` counter per T018's log+metric requirement)
- [X] T038 Batch generation tombstones per product (kill the per-pair N+1 by reusing `supersedeSuggestionPairs` grouped by productId), batch the staged-pairs insert in 500-row chunks, drop the impossible-UUID sentinel query for empty `componentIds` (skip the query), and match the sibling `typeof id === "string"` filter instead of `componentId!` in `createProduct`
- [X] T039 `sendServiceError` in `routes/suggestions.ts` falls back to `code: "CONFLICT"` regardless of statusCode — map status→code (404→NOT_FOUND, 409→CONFLICT, 403→AUTH_FORBIDDEN, 400/422→their codes) so status and code stay consistent
- [X] T040 Docs and polish — `digital-products.md` trigger list corrected (bootstrap apply, promotion, product name/tag writes, component tag/group writes — "component rename" was unreachable) plus a tombstone caveat note; contracts `422` row removed (single-component path can't emit it); migration 014 queue index is `(status, score DESC)` per data-model; `suggestions-page.test.tsx` renamed → `suggestions.test.tsx` per T008

## Phase 9: Review follow-ups (round 2)

Re-review (`git diff origin/main` + untracked) residuals; apply and re-verify.

- [X] T041 Narrow `input.componentId` in `addDependsOnEdge` (dropped the `!` — schema refine makes it unreachable but explicit narrowing is the convention) and `dismissSuggestion` is now transactional (`forUpdate` select inside a trx → a deleted-between row yields 404, not 409)
- [X] T042 True rescan idempotency — the staged-pairs `ON CONFLICT DO UPDATE` counted unchanged rows, so a second rescan never returned `staged: 0` as quickstart.md:27 promises; the update is now guarded by `IS DISTINCT FROM` (reason/score) and the idempotency test asserts `staged: 0`
- [X] T043 Queue pagination — `useSuggestions(view, offset)` passes `offset` through; the page got a URL-bound Prev/Next pager (FR-008: rows past the first 50 were unreachable while `total` claimed more)
- [X] T044 Extracted shared route helpers — `ServiceError`/`actor`/`validationFailed`/`sendServiceError` now live in `routes/route-helpers.ts` with the status-map fallback + `isErrorCode` check; migrated products/components/org/suggestions (also fixes components/org emitting unvalidated `error.code`)
- [X] T045 Tombstone attribution — bypass-path writes (createProduct componentIds fast-path, promotion's own platform edge, bootstrap edge inserts) now call `supersedeSuggestionPairs(trx, …, actor)` inline so `decidedBy` records the wiring actor per data-model.md
- [X] T046 Polish — `suggestions.tsx` uses `roleAtLeast` from `lib/roles`; bodiless POSTs dropped `JSON.stringify({})`; `suggestionReasonCheck`/`suggestionStatusCheck` exports added to `check-constraint-helper.ts` (per plan/data-model — migration keeps the bare-`sql` convention since helper fragments embed `CHECK` and can't feed `addCheckConstraint`); `/suggestions` added to `docs/ux.md` route map

## Phase 10: Review follow-ups (round 3)

Re-review (committed diff `174ab5e` vs `origin/main`) residuals.

- [X] T047 Tombstone on edge removal — `removeDependsOnEdge` deletes + audits but never tombstones; a pair wired pre-feature and removed before any pass observed it can regenerate (FR-006 is unconditional). Call `supersedeSuggestionPairs` for the removed pair — expanding current members for `kind: "group"` — inside a transaction with the delete
- [X] T048 Signal fidelity per FR-004 — NAMESPACE_MATCH must only fire for `provider === "KUBERNETES"` components (spec: "a Kubernetes component's imported details.namespace"), and `product.slug` must leave the product token set (spec lists product *name* and *tags* only; component side keeps name+slug). Update `SignalComponent`, the components query, and signal unit tests
- [X] T049 One actor helper — `route-helpers.ts` `actor()` duplicates the pre-existing `services/actor.ts` `toActor()` (used by ~9 routes) plus a third copy in `routes/audit.ts`. Re-export `toActor` from route-helpers (or migrate call sites) and delete the audit.ts local
- [X] T050 Service polish — `toQueueItem` reuses `toContract` for the shared field mapping; DISMISSED ordering gains an `id` tiebreaker for stable offset pagination; an empty `componentIds` scope early-returns before the products query (`productsScanned: 0`); `updateProduct`/`updateComponent` suggestion triggers fire only on actual signal-field *changes*, not mere presence in the body
- [X] T051 Frontend polish — swap the raw `<select>` for the `ui/select.tsx` `Select` component (focus ring + consistent styling); pass `limit` explicitly so `PAGE_SIZE` doesn't silently couple to the Zod default

## Phase 11: Convergence

- [X] T052 Update the signal table in `docs/digital-products.md` to match T048: NAME_MATCH is product *name* vs component name/slug (product slug is not a signal source), and NAMESPACE_MATCH is Kubernetes components' `details.namespace` only per FR-004 (partial)

## Phase 12: Review follow-ups (round 4)

Re-review (working tree vs `origin/main`, incl. uncommitted round-3 fixes) residuals.

- [X] T053 SC-002 performance — hoist per-entity tokenization out of the product×component loop: add `prepareProduct`/`prepareComponent` (precomputed name/tag-side/namespace token Sets) and `scorePrepared` to `suggestion-signals.ts`; `scorePair` becomes a thin wrapper; `generateSuggestions` prepares each entity once then scores prepared pairs (10k-component rescan must stay under a minute)
- [X] T054 Drop the dead `slug` trigger in `updateProduct` — post-T048 the product slug is not a signal input, so a slug-only PATCH runs a scoped pass that can never change any score
- [X] T055 Dedupe + convention — shared `tagsDiffer` helper (exported from `suggestion-signals.ts`, used by `updateProduct`/`updateComponent`); `routes/audit.ts` drops its local `AuthenticatedRequest` interface for the `plugins/session.js` import; `toContract` param narrows to `Pick<JoinedRow,…>`; remove the `as unknown as JoinedRow` cast if the query type infers cleanly; `useSuggestions` builds its query with `URLSearchParams` like every other hook
- [X] T056 Drift + metric — `contracts/edge-suggestion.ts:23` and `data-model.md:99` say "persons.name join" (actual: `coalesce(displayName, username)`); `research.md` D3 still says product tokens come from `name` + `slug` (post-T048: name only); the rescan route's catch should increment `suggestion_pass_errors_total` so user-initiated failures count too

## Phase 13: Review follow-ups (round 5)

Re-review (working tree vs `origin/main`) residuals — polish only, no spec gaps.

- [X] T057 One name for the actor helper — migrate `actor(` call sites in `products.ts`/`org.ts`/`suggestions.ts` to the canonical `toActor` from `services/actor.ts` (used by ~8 other routes) and drop the `toActor as actor` re-export from `route-helpers.ts`
- [X] T058 Type `SignalComponent.provider` as `ComponentProvider` (core controlled enum, constitution III) instead of `string`; the DB row's `string` needs one honest cast at the `prepareComponent` call site
- [X] T059 Delete production-dead `scorePair` — post-T053 only the unit suite calls it; the test file gets a local `score(p, c)` helper built on `prepareProduct`/`prepareComponent`/`scorePrepared`
- [X] T060 Frontend — extract a `withToast(fn, fallback)` helper deduping the three near-identical try/toast handlers in `suggestions.tsx`; scope `placeholderData` to same-view only (`prevQuery?.queryKey[1] === view`) so switching PENDING→DISMISSED doesn't flash stale rows
- [X] T061 Nits — the empty-`componentIds` no-op returns its zero-report directly without `finishPass` (a deliberate no-op shouldn't inflate `suggestion_passes_total` or log "pass complete"); `contracts/api.md` accept/dismiss 200 wording corrected to the `{suggestion:…}` envelope
