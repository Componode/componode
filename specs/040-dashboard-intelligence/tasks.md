# Tasks: Dashboard Intelligence

**Input**: Design documents from `/specs/040-dashboard-intelligence/`
**Tests**: Included — integration tests per endpoint (constitution VI).

## Phase 1: Backend — attention detail + CREDENTIAL_EXPIRING (US1, P1) 🎯 MVP

- [x] T001 [US1] Regression test: `GET /dashboard/summary` attention rows carry `detail` (OFFLINE_AGENT → last-contact + disconnectReason; FAILED_RUN → errorType/errorMessage context; null when nothing to add); credential with `expiresAt` in 3 days yields a `CREDENTIAL_EXPIRING` row (`href` `/credentials/{id}`, `at` = expiresAt, ranked below OFFLINE_AGENT / above SUNSET_*); null or >30d `expiresAt` yields none — `packages/backend/test/integration/` (dashboard test)
- [x] T002 [US1] Add `detail: string | null` to `AttentionItem` and `CREDENTIAL_EXPIRING` to the kind union in `packages/backend/src/services/dashboard-service.ts`; compose per-kind detail strings server-side (add `errorType`/`errorMessage` to the failedRuns select; `lastSeenAt` + DISTINCT ON `disconnectReason` for OFFLINE_AGENT — pattern: `lastDisconnectReasons` in agent-service.ts)
- [x] T003 [US1] Emit `CREDENTIAL_EXPIRING` items: query `credentials` where `expiresAt` non-null and `<= now + 30 days` (expired included), `label` = credential label, `at` = `expiresAt`, ordered asc by `expiresAt`; splice into the attention merge between OFFLINE_AGENT and the sunset items — `packages/backend/src/services/dashboard-service.ts`

## Phase 2: Backend — stat deltas (US2, P1)

- [x] T004 [US2] Regression test: `deltas.{products,components,instances}` = rows with `createdAt` in the trailing 7 days scoped to headline populations (products: all; components: `lifecycle='ACTIVE'`; instances: `status != 'GONE'`); zero is a real value — `packages/backend/test/integration/` (dashboard test)
- [x] T005 [US2] Add `deltas` to `DashboardSummary` + three grouped `createdAt >= now - 7 days` count queries in `packages/backend/src/services/dashboard-service.ts` (parameterized interval, no `sql.raw` — ADR-084)

## Phase 3: Backend — agent enrolled-by (US3, P2)

- [x] T006 [US3] Regression test: `GET /agents/:id` returns `createdBy` = enrolling person's `COALESCE(displayName, username)` (null when column null / person gone), and `enrollmentExpiresAt` = live pending-token expiry else null — `packages/backend/test/integration/` (agents test)
- [x] T007 [US3] Add `createdBy: string | null` + `enrollmentExpiresAt: string | null` to `ImportAgent` in `packages/core/src/contracts/import-agent.ts`
- [x] T008 [US3] Populate both in `toApi`/`getAgent` in `packages/backend/src/services/agent-service.ts`: `LEFT JOIN persons` on `import_agents.createdBy` → `COALESCE(displayName, username)`; `enrollmentExpiresAt` = `enrollmentTokenExpiresAt` gated on the existing `pendingEnrollment` predicate

## Phase 4: Contract + types

- [x] T009 Update `docs/openapi.yaml` (ADR-104): `AttentionItem.detail`, `CREDENTIAL_EXPIRING` in the kind enum (+ rank note), `DashboardSummary.deltas`, `ImportAgent.createdBy`/`enrollmentExpiresAt`; run `pnpm docs:api` and `pnpm --filter @componode/backend test -- api-docs-contract`
- [x] T010 Append **Amendment 4** to `researches/adrs/ADR-116-remote-import-agents.md` ratifying `detail` + `CREDENTIAL_EXPIRING` (kind-enum extension, rank below OFFLINE_AGENT / above sunset kinds); update the amends list in `researches/architecture-decisions.md`
- [x] T011 Mirror the new fields in `packages/frontend/src/api/types.ts`: `AttentionItem.detail` + `CREDENTIAL_EXPIRING` kind, `DashboardSummary.deltas`, agent `createdBy`/`enrollmentExpiresAt`

## Phase 5: Frontend wiring + flag flips

- [x] T012 Wire `item.detail` through `mapAttentionItem` in `packages/frontend/src/api/mappers/dashboard.ts` (currently stubbed `null`)
- [x] T013 Wire `createdBy`/`enrollmentExpiresAt` through `mapImportAgent` in `packages/frontend/src/api/mappers/operations.ts` (currently stubbed `""`/`null`)
- [x] T014 Pass `summary.data.deltas` + importer-health (derived from `summary.data.attention` — any FAILED_RUN/OFFLINE_AGENT ⇒ not healthy) into `StatGrid` in `packages/frontend/src/ux/app/index.tsx`; render "All healthy" on the importers card in `packages/frontend/src/ux/components/dashboard/stat-grid.tsx`
- [x] T015 Flip `statDeltas`, `attentionDetail`, `credentialExpiring`, `agentEnrolledBy` to `true` in `packages/frontend/src/ux/lib/flags.ts`; drop flag-off fallbacks the flags only ever gated; refresh stale comments
- [x] T016 Frontend tests: mapper pass-through (detail, createdBy, enrollmentExpiresAt) + StatGrid delta/"All healthy" rendering — `packages/frontend/test/` or co-located test files per convention

## Phase 6: Governance + ship

- [x] T017 Mark G23, G24, G25 RESOLVED (spec 040, flags flipped) in `researches/ux-rewrite-gaps.md`; update the spec-queue block
- [x] T018 Update `docs/roadmap.md` — 040 under Shipped; Next entry revised
- [ ] T019 Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build`; commit, push, PR

## Phase 7: Convergence

- [x] T020 Emit `importerIssues` (full-queue count of FAILED_RUN + OFFLINE_AGENT attention items, computed before the ATTENTION_LIMIT slice) on `GET /dashboard/summary`; update `docs/openapi.yaml` + `api/types.ts`; use it in `ux/app/index.tsx` instead of counting the truncated attention array — per US2/AC4 (partial)

## Phase 8: Review (code-review findings vs `main`)

- [x] T021 Gate `enrollmentExpiresAt` on `revokedAt IS NULL` in `toApi` (agent-service.ts): a revoked agent's unused token cannot be exchanged, so its expiry must not surface — spec edge case "live pending token only" (code-review: spec)
- [x] T022 Add `importerIssues` to ADR-116 Amendment 4; fix G23 resolution wording in `researches/ux-rewrite-gaps.md` (count emitted pre-truncation, not derived from the array) (code-review: standards, ADR fidelity)
- [x] T023 Remove resolved flags `statDeltas`/`attentionDetail`/`credentialExpiring`/`agentEnrolledBy` from `ux/lib/flags.ts` and their gates in stat-grid.tsx, attention-list.tsx, agent-detail.tsx (FR-005 — flags were only ever the off-switch; `profileSelfEdit` precedent) (code-review: spec+standards)
- [x] T024 Fix `at: ""` for `INSTANCE_*` attention items — use observation time when `lastSeenAt` is null so `at` conforms to OpenAPI `format: date-time` (code-review: standards)
- [x] T025 Add `.limit(ATTENTION_LIMIT)` to the `expiringCredentials` query for consistency with sibling queries (code-review: standards)
- [x] T026 Deduplicate the DISTINCT-ON disconnect-reason query — export/reuse `lastDisconnectReasons` from agent-service.ts in dashboard-service.ts (code-review: standards)
- [x] T027 Fix React key collision in attention-list.tsx (`key={item.label}` → `${kind}-${href}`) (code-review: standards)
- [x] T028 Regression test: revoked agent with unused enrollment token returns `enrollmentExpiresAt: null` — packages/backend/test/integration/agents.test.ts (code-review: spec)

## Dependencies

- Phases 1, 2, 3 parallel (independent backend surfaces); Phase 4 needs
  the field names from 1–3; Phase 5 needs Phase 4 types; Phase 6 last.
- T007 (core type) precedes T008; T002 precedes T003.

## Implementation strategy

MVP = Phase 1 alone (attention detail + CREDENTIAL_EXPIRING is the
highest-value slice); Phases 2–3 are independent increments.
