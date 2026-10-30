# Tasks: UX Conformance — v1.1.0 Review Corrections

**Input**: Design documents from `/specs/038-ux-11-conformance/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: Included — every defect fix is test-first per constitution VI.

## Phase 1: Setup

- [x] T001 Verify baseline: `pnpm lint && pnpm typecheck && pnpm test` green on branch `038-ux-11-conformance` before any change

---

## Phase 2: Foundational (shared prerequisites)

- [x] T002 [P] Add `replaced` entry to `DISCONNECT_REASON_META` and add `KIND_META` (moved from `ux/components/admin/credential-form.tsx:17`) in `packages/frontend/src/ux/lib/domain.ts`
- [x] T003 [P] Add out-of-union lookup guards (neutral fallback, never throw) to `StatusBadge`/`ProductTypeBadge` in `packages/frontend/src/ux/components/patterns/status-badge.tsx` and `ProviderMark` in `packages/frontend/src/ux/components/patterns/provider-mark.tsx`
- [x] T004 [P] Fix mapper fallbacks to neutral badge: unknown run status → neutral (not `FAILED`) at `packages/frontend/src/api/mappers/operations.ts:110`, unknown credential status → neutral (not `ACTIVE`) at `operations.ts:228`, with unit tests in the existing mappers test file
- [x] T005 Add new gap flags and remove `profileSelfEdit` in `packages/frontend/src/ux/lib/flags.ts` — keys: `componentListHealth`, `componentListLastSeen`, `teamMemberCounts`, `statDeltas`, `attentionDetail`, `credentialExpiring`, `agentEnrolledBy`, `detailGoneInstances`, `manualEntityCreate`, `suggestionsHistory` (all `false`)
- [x] T006 Write the twelve new gap entries G21–G32 in `researches/ux-rewrite-gaps.md` per `specs/038-ux-11-conformance/data-model.md` (surface, missing capability, resolution plan, queue position)

**Checkpoint**: domain metadata complete, flags + registry scaffolded.

---

## Phase 3: User Story 1 — Functional defects (P1) 🎯 MVP

**Goal**: No dead links, dead controls, invisible opt-in data, or lying copy.

**Independent Test**: quickstart.md items 1–6.

### Tests for User Story 1 (write first, ensure FAIL)

- [x] T007 [P] [US1] Regression test: attention hrefs are slug-keyed in `packages/backend/src/services/dashboard-service.test.ts` (or nearest existing test) — component rows emit `/components/{slug}`
- [x] T008 [P] [US1] Regression test: users-table "Send password reset" calls `useResetPassword` in `packages/frontend/src/test/` (component or existing suite location)
- [x] T009 [P] [US1] Regression test: LOB delete `blockedReason` counts teams + products — `packages/frontend/src/ux/app/lobs/` or component test
- [x] T010 [P] [US1] Regression test: mapper produces neutral badge for unknown run/credential status (covered in T004 — mark done if folded)

### Implementation for User Story 1

- [x] T011 [US1] Backend: add `components.slug` to `errorInstances` and `sunsetComponents` selects and emit `/components/{slug}` hrefs in `packages/backend/src/services/dashboard-service.ts` (~lines 125, 194, 215)
- [x] T012 [US1] Wire "Send password reset" `DropdownMenuItem` to `useResetPassword` (token-once toast) in `packages/frontend/src/ux/components/admin/users-table.tsx:138`
- [x] T013 [US1] Fix LOB delete guard to count teams + products in `packages/frontend/src/ux/app/lobs/$slug.tsx:69`
- [x] T014 [US1] Wire `includeGone` param + opt-in control on components list (`packages/frontend/src/ux/app/components/index.tsx`, hook `useComponents`) matching the retired-toggle pattern
- [x] T015 [US1] Wire `lifecycle` param + RETIRED opt-in on component-groups list (`packages/frontend/src/ux/app/component-groups/index.tsx`, `useComponentGroups`)
- [x] T016 [US1] Breadcrumbs: use `ux()`, drop `/ux` segment handling, resolve entity names in `packages/frontend/src/ux/components/app/app-header.tsx:23-35`
- [x] T017 [US1] Wire "convert secrets" control on importer detail to `useConvertSecrets` in `packages/frontend/src/ux/components/importers/importer-detail.tsx` (hook: `api/hooks/importers.ts:95`)
- [x] T018 [US1] Map `409 SLUG_TAKEN` to a field-level error under the Slug input in `packages/frontend/src/ux/components/components/promote-form.tsx`
- [x] T019 [US1] Human-sentence feed summaries for known actions in `packages/frontend/src/api/mappers/dashboard.ts:79-85` (generic fallback retained)
- [x] T020 [US1] Catch-all 404 uses prototype copy (`src/routes.tsx:121-127`); root `ErrorBoundary` renders `ErrorState`, drops raw `error.message` echo in `packages/frontend/src/app.tsx:76-96`
- [x] T021 [P] [US1] Add `ForbiddenState` branches to `packages/frontend/src/ux/app/lobs/$slug.tsx:32-41`, `packages/frontend/src/ux/app/component-groups/$slug.tsx:51-60`, `packages/frontend/src/ux/app/users/$id.tsx:32-38`
- [x] T022 [US1] Sidebar persistence → `sessionStorage` in `packages/frontend/src/ux/ux-shell.tsx:10-19`; remove dead `sidebar_state` cookie write in `packages/frontend/src/ux/components/ui/sidebar.tsx:84`
- [x] T023 [US1] Importer cards render real `lastRun` — join `DashboardSummary.lastRuns` by `configId` in `packages/frontend/src/api/mappers/operations.ts:101` + `ux/components/importers/importer-card.tsx:63-86`
- [x] T024 [US1] Correct component-detail "Gone instances" copy to describe actual API behavior (G26 flags detail-level opt-in) in `packages/frontend/src/ux/components/catalog/component-detail.tsx:67`
- [x] T025 [US1] Show `agentIncompatible` degraded state on the importer-detail Executor row in `packages/frontend/src/ux/components/importers/importer-detail.tsx:118-127`

**Checkpoint**: quickstart items 1–6 pass.

---

## Phase 4: User Story 2 — Conformance restorations (P2)

**Goal**: Restore prototype elements silently dropped, where backend-real.

**Independent Test**: quickstart items 8–14; element-diff vs v0.

- [x] T026 [P] [US2] Restore password-rules checklist + "New accounts start as Viewer" alert in `packages/frontend/src/pages/register.tsx` (v0 `register-form.tsx:86-97` parity); NO work-email field (G27)
- [x] T027 [P] [US2] Restore versioned auth footer on `packages/frontend/src/pages/{login,register,oidc-callback}.tsx`
- [x] T028 [US2] Wrap OIDC callback in the `AuthShowcase` two-column shell in `packages/frontend/src/pages/oidc-callback.tsx`
- [x] T029 [P] [US2] Restore "Write-only by design" ShieldCheck alert on `packages/frontend/src/ux/app/credentials/index.tsx`
- [x] T030 [P] [US2] Restrict workspace default-role select to Viewer/Editor in `packages/frontend/src/ux/app/settings/workspace.tsx:64`
- [x] T031 [P] [US2] Render device + location in security sessions list in `packages/frontend/src/ux/app/settings/security.tsx:87` (flags ON)
- [x] T032 [P] [US2] Conform org owned-entity tables to v0 column sets (`Team | Members | Members→Components`, `Component | Category | Instances`, `Product | Owning team | Lifecycle`) in `packages/frontend/src/ux/components/org/{org-detail,org-tables}.tsx`; use `CATEGORY_LABELS` on group Members
- [x] T033 [P] [US2] Restore command-menu adornments — `ProviderMark` + `font-mono` on component results, muted team-owner suffix on products — in `packages/frontend/src/ux/components/app/command-menu.tsx`
- [x] T034 [P] [US2] Add full `--radius-sm…4xl` scale matching v0 derivation in `packages/frontend/src/ux/styles.css` `@theme` block
- [x] T035 [US2] Consume `HEALTH_META` in product-map DOT map in `packages/frontend/src/ux/components/products/product-map.tsx:19-24` (removes ad-hoc status→color table)
- [x] T036 [US2] Conform copy drift: users-page description, sessions page "User" column + revoke copy/toast, stale comments in `ux/app/components/index.tsx:12` and `app-header.tsx` — match v0 strings

**Checkpoint**: quickstart items 8–14 pass; all free restorations done.

---

## Phase 5: User Story 3 — Product map data + ratification (P2)

**Goal**: Canvas displays all fetched relations; boundary ratified via ADR.

**Independent Test**: product with all four relation kinds shows them; ADR + ux.md §8 updated.

- [x] T037 [US3] Pass `composedBy`/`composes`/`consumesFrom`/`dependsOnGroups` to the map and render labeled relation kinds (edge labels or legend) in `packages/frontend/src/ux/app/products/$slug.tsx:73` + `ux/components/products/product-map.tsx`
- [x] T038 [US3] Feed real `criticality` into `CriticalityBadge` on consumers (map + Consumed-by card) — `product-detail.tsx:263-268`, `product-map.tsx:167`
- [x] T039 [US3] New ADR `researches/adrs/ADR-XXX-product-map-canvas.md` ratifying the in-app graph canvas; `Amended by` back-pointer on ADR-103; index update in `researches/architecture-decisions.md`; `docs/ux.md` §8 amended
- [x] T040 [US3] Amend `docs/ux.md` §2 (ratified system-font stack) and §9 (deferred standards surface, descoped Provider scaffold, pending decided-history view)

**Checkpoint**: spec acceptance scenarios US3-1..3 pass.

---

## Phase 6: User Story 4 — Governance closure (P3)

**Goal**: Every stub flagged + registered; no fakes; no unconsumed flags.

**Independent Test**: flag/usage greps; every formerly-dead control deleted or wired.

- [x] T041 [US4] Delete header Help/Notifications buttons + fake unread dot in `packages/frontend/src/ux/components/app/app-header.tsx:66-80`
- [x] T042 [US4] Flag-gate "Add manually" (`ux/app/components/index.tsx:22`) and "New group" (`component-groups/index.tsx:23`) behind `manualEntityCreate` with gap-notice fallback
- [x] T043 [US4] Flag-hide dead-data renders: stat deltas (`ux/app/index.tsx:72-79` → `statDeltas`), attention `detail` (`attention-list.tsx` → `attentionDetail`), components-list Health/Last-seen columns (`components-table.tsx` → `componentListHealth`/`componentListLastSeen`), teams Members column (`teamMemberCounts`), agent enrolled-by (`agentEnrolledBy`)
- [x] T044 [US4] Render a gap notice (not empty section) for `workspaceProfile` on `packages/frontend/src/ux/app/settings/workspace.tsx:70`, matching the other flagged settings pages
- [x] T045 [US4] Verify flag↔registry invariants: every `flags.` key consumed ≥1 site; every consumption maps to a G-entry; remove any orphan

**Checkpoint**: SC-001/002/006 verifiable by grep + click-through.

---

## Phase 7: Polish & ship

- [x] T046 Update `docs/roadmap.md` — feature marked complete under Shipped; Next entry revised (G21–G32 queue)
- [x] T047 Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build`; walk `specs/038-ux-11-conformance/quickstart.md`
- [x] T048 Changeset for the conformance batch (follow repo changeset conventions)

---

## Dependencies & Execution Order

- **Phase 2** blocks all stories (META/flags/registry shared).
- US1 (Phase 3) is the MVP — defects first; US2–US4 may run in parallel after Phase 2.
- Phase 7 depends on all stories.

## Implementation Strategy

MVP = Phase 3 alone (defect batch). Then restorations, canvas+ADR, governance. Commit per task group with `git commit -F <file>` per the Windows rule.

---

## Phase 8: Convergence

- [x] T049 Consume or remove the three orphaned flags `credentialExpiring`, `detailGoneInstances`, `suggestionsHistory` — every flag key needs ≥1 consumption site per SC-006/US4-AC1 (missing)
- [x] T050 Append `---` + `**Amended by ADR-118**:` back-pointer to `researches/adrs/ADR-103-*.md` per FR-026 and the ADR-fidelity rule (missing)
- [x] T051 Write regression tests for T008 (users-table "Send password reset" calls `useResetPassword`) and T009 (LOB delete `blockedReason` counts teams + products) per SC-004 (missing)
- [x] T052 Render `CATEGORY_LABELS[c.category] ?? c.category` in the group members table at `packages/frontend/src/ux/app/component-groups/$slug.tsx:220` per FR-015 (partial)

---

## Phase 9: Review (code-review findings vs `main`)

- [x] T053 Delete the dead "Add link" ghost button in `product-detail.tsx` Links CardAction — fake control, no flag (Standards / FR-020 class)
- [x] T054 Add a RETIRED opt-in control on `component-groups/index.tsx` consistent with the components-list pattern — `includeRetired` must not be hardcoded `true` (FR-005 partial)
- [x] T055 Fix `mapCredentialStatus(null)` in `mappers/operations.ts:228` to return a neutral fallback instead of `"ACTIVE"` (FR-013 partial)
- [x] T056 Delete the dead `useComponentGroups` export in `api/hooks/components.ts:73` (duplicated by `component-groups.ts`; zero callers) (partial)
- [x] T057 Conform `OrgDetail` owned tables to v0 column sets: LOB teams `Team | Members | Components` (counts flag-gated `teamMemberCounts`), products `Product | Owning team | Lifecycle`, components `Component | Category | Instances` (FR-015 partial)
- [x] T058 Surface `agentIncompatible` degraded state on the importer-detail Executor `DescriptionList` row, not only the top Alert (FR-019 partial)
- [x] T059 Hide the redundant "User" column on the self-scoped sessions page (edge case — conform to prototype)
- [x] T060 Revise `docs/roadmap.md` Next entry — G21–G25 queued specs (list enrichment, dashboard intelligence) are not "the UX-rewrite gap program is complete" (FR-031 partial)
- [x] T061 Make feed summaries human sentences for known actions, not formatted change-key joins, in `mappers/dashboard.ts:85-101` (FR-009 partial)
- [x] T062 Fix stale G14 registry text claiming `profileSelfEdit` is ON (flag removed) in `researches/ux-rewrite-gaps.md` (unrequested drift)
- [x] T063 Clean small smells: dead `ErrorBoundaryState.message` field, `TONE_DOT` duplication in product-map, redundant `as` casts (`agent-detail.tsx:104`, `command-menu.tsx:81,90`, `importers/index.tsx:48`) (partial)
- [x] T064 Add regression tests for FR-003 (`replaced` badge meta coverage), FR-009 sentence shape, FR-013 null-credential neutral fallback in the frontend suite (SC-004 partial)
