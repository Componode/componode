---

description: "Task list for 018-edge-rule-ergonomics implementation"
---

# Tasks: Edge-Rule Ergonomics

**Input**: Design documents from `/specs/018-edge-rule-ergonomics/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api.md, quickstart.md

**Tests**: Included — constitution VI (test-first). Existing tests asserting the rescinded rule are flipped to acceptance tests *before* the checks are removed (red → green).

**Organization**: Tasks grouped by user story; this feature removes code, so most tasks are deletions + test updates.

## Phase 1: Setup

- [x] T001 Confirm green baseline on `feature/018-edge-rule-ergonomics`: `pnpm lint && pnpm typecheck && pnpm --filter @componode/backend vitest run test/integration/products.test.ts`

## Phase 2: User Story 1 — Compose parts under a platform (Priority: P1) 🎯 MVP

**Goal**: Any product type is a legal `COMPOSES` parent; self-edge and cycle guards unchanged.

**Independent Test**: `POST /products/<platform>/composes {childId}` → `204` where it was `422`.

- [x] T002 [US1] Flip `products.test.ts` (in `packages/backend/test/integration/`) — the existing `COMPOSES cycle → 409 CYCLE_DETECTED; PLATFORM parent → 422` test: split it so the PLATFORM-parent case asserts `204` and the edge row exists; keep the cycle case asserting `409 CYCLE_DETECTED`; add a self-edge assertion (`parentId === childId` → `422 INVALID_EDGE_TYPE`) if not already covered (US1/AC1–AC3)
- [x] T003 [US1] Remove the `COMPOSES_PARENT_TYPE` check (`parent.type !== "BUSINESS_CAPABILITY" && parent.type !== "CUSTOMER_FACING"` → `invalidEdge`) from `addComposesEdge` in `packages/backend/src/services/product-edge-service.ts`; leave `SELF_EDGE`, `assertNoCycle`, existence checks, and `writeEdgeChange` untouched
- [x] T004 [P] [US1] Remove the `canBeParent`/`disabled` gating and the "Only Business Capability and Customer-Facing products can be COMPOSES parents" notice from `packages/frontend/src/components/products/edge-picker.tsx`; update the file's doc-comment (ADR-109, not ADR-018); keep the `consumes-from` PLATFORM-target filter
- [x] T005 [P] [US1] Frontend unit coverage for the ungated composes flow — no `edge-picker` test exists today; either add a focused `packages/frontend/src/test/unit/edge-picker.test.tsx` asserting the composes select is enabled for a `PLATFORM` parent (and the "only BC/CF" notice is gone), or explicitly note quickstart §5 manual verification as the acceptance for FR-006

**Checkpoint**: US1 complete — `products.test.ts` green with PLATFORM-parent acceptance; EdgePicker allows composes on any product.

## Phase 3: User Story 2 — Retype without false edge conflicts (Priority: P2)

**Goal**: Type→`PLATFORM` no longer blocked by `COMPOSES` children; `CONSUMES_FROM` target protection unchanged.

**Independent Test**: `PATCH /products/:id {type:"PLATFORM"}` on a product with composes children → `200`, edges intact.

- [x] T006 [US2] Add/flip tests in `products.test.ts` (`packages/backend/test/integration/`): retype a `BUSINESS_CAPABILITY` product that has `COMPOSES` children to `PLATFORM` → `200` + child edge survives; retype a `CONSUMES_FROM` *target* away from `PLATFORM` → `409 TYPE_CHANGE_BLOCKED` with `details.edges` naming offenders (US2/AC1–AC2)
- [x] T007 [US2] Remove the `parsed.type === "PLATFORM"` offenders branch (COMPOSES children lookup + `offenders.push`) from `updateProduct` in `packages/backend/src/services/product-service.ts`; keep the `parsed.type !== "PLATFORM"` CONSUMES_FROM branch; update the doc-comment to reflect ADR-109 (drop the "scheduled for removal" note added in spec 017)

**Checkpoint**: US2 complete — retype-to-PLATFORM green; target-rule block still enforced.

## Phase 4: User Story 3 — Documentation matches behavior (Priority: P2)

**Goal**: Binding + product-model docs state the relaxed rule.

**Independent Test**: `grep -rn "CUSTOMER_FACING" docs/digital-products.md AGENTS.md` shows no COMPOSES-parent restriction.

- [x] T008 [P] [US3] Update `docs/digital-products.md` — the `COMPOSES` rule paragraph ("parent must be BUSINESS_CAPABILITY or CUSTOMER_FACING") and the "Can be a COMPOSES parent" subgraph so any product type is a legal parent, citing ADR-109 (FR-007)
- [x] T009 [P] [US3] Update the AGENTS.md graph rule — "`COMPOSES` parent must be `BUSINESS_CAPABILITY` or `CUSTOMER_FACING`. See `ADR-018`" → any-type parent citing `ADR-109` (keeps the binding doc truthful per plan Constitution Check)

## Phase 5: Polish & Cross-Cutting

- [x] T010 Verify `pnpm --filter @componode/backend docs:api` / api-docs contract test still passes — no openapi changes expected (contracts/api.md: `COMPOSES_PARENT_TYPE` was a `details.rule` string, not an error `code`) (FR-008 adjacency)
- [x] T011 Add changeset `.changeset/edge-rule-ergonomics-018.md` — minor bumps for `@componode/backend` + `@componode/frontend` (behavioral relaxation)
- [x] T012 Update `docs/roadmap.md` — add `018-edge-rule-ergonomics` to Shipped
- [x] T013 Full gate: `pnpm lint && pnpm typecheck && pnpm test && pnpm build`; walk all quickstart.md scenarios (PLATFORM parent, self-edge, cycle, retype, CONSUMES_FROM target, UI flow); sweep `grep -rn "COMPOSES parent\|parents must" docs/ CONTEXT.md AGENTS.md` to confirm no stale parent-type rule remains (SC-003)

## Dependencies

```text
Phase 1 (Setup) → {US1, US2, US3} → Phase 5 (Polish)

US1 (composes parent):   independent — backend check + UI gate
US2 (type-change guard): independent — different service function; tests share
                         products.test.ts, so serialize test edits with T002
US3 (docs):              independent — docs only
```

## Parallel Execution

- **US1**: T004 ∥ T005 (frontend) can run alongside T002/T003 (backend test + service); T003 follows T002 (test-first)
- **US2**: T006 before T007 (same file discipline)
- **US3**: T008 ∥ T009 (different files)

## Implementation Strategy

**MVP**: Phase 1 + Phase 2 (US1) — the actual restriction removal. US2 is a
three-line deletion with a flipped test; US3 is docs. Polish gates the PR.

**Suggested checkpoint**: `products.test.ts` must be green after each story;
the flipped 422 → 204 assertions are the proof of intent.
