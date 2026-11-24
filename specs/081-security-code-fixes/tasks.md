# Tasks: Code-Scanning Code Fixes (Slugify Consolidation + OIDC Issuer Hardening)

**Input**: Design documents from `/specs/081-security-code-fixes/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included — constitution VI (test-first) is non-negotiable.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2)
- Paths are repo-root relative

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish a green baseline before any change

- [x] T001 Run baseline checks: `pnpm install` at repo root, then `pnpm --filter @componode/backend test -- slug` and `pnpm --filter @componode/backend test -- settings` — record that `packages/backend/test/unit/slug.test.ts` and the OIDC cases in `packages/backend/test/integration/settings.test.ts` pass on the untouched tree

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The canonical `slugify` must exist in `packages/core` before any call site can migrate

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T002 Write the failing unit test `packages/core/test/slug.test.ts` covering every reference case in `specs/081-security-code-fixes/contracts/slug.md` — including `""` and `"---"` → `""`, unicode collapse (`"héllo wörld"` → `"h-llo-w-rld"`), `maxLength` truncation without a dangling `-`, and an adversarial `"-" * 1_000_000` input that must complete in under ~500 ms. Confirm it FAILS (module does not exist)
- [x] T003 Implement `slugify(input: string, maxLength?: number): string` in `packages/core/src/utils/slug.ts` per research D2 — collapse regex `[^a-z0-9]+` → `-` retained, edge-trim via `startsWith/endsWith` index checks (NO `+`-quantified regex on `-`), `slice(0, maxLength)` then strip dangling trailing `-`; re-export from `packages/core/src/index.ts`. Confirm T002 passes
- [x] T004 Build core so dependents compile: `pnpm --filter @componode/core build`

**Checkpoint**: `slugify` available from `@componode/core` — US1 migrations may begin

---

## Phase 3: User Story 1 - Slug generation is safe, single-sourced, and unchanged in behavior (Priority: P1) 🎯 MVP

**Goal**: All duplicated slug chains delegate to `@componode/core` `slugify`; flagged regex pattern gone

**Independent Test**: `packages/core/test/slug.test.ts` green; every former copy deleted; backend `test/unit/slug.test.ts` still green unchanged; `rg 'replace\(/\^-\+' packages/` matches nothing outside `user-service.ts`

### Implementation for User Story 1

- [x] T005 [US1] Rewrite `packages/backend/src/utils/slug.ts` to import `slugify` from `@componode/core`, re-export it, and keep `generateUniqueSlug` / `generateComponentSlug` / `generateInstanceSlug` wrappers unchanged — existing importers of this file must not need edits
- [x] T006 [P] [US1] In `packages/backend/src/services/product-service.ts` replace the `toSlug` body (lines ~68–75) with `slugify(name, 100)` from `@componode/core`; keep the exported signature `toSlug(name: string): string` (consumers: `catalog-bootstrap-service.ts`, `platform-promotion-service.ts`)
- [x] T007 [P] [US1] In `packages/backend/src/services/org-service.ts` replace the local `toSlug` (lines ~46–53) with `slugify(name, 100)` from `@componode/core`
- [x] T008 [P] [US1] In `packages/backend/src/services/credential-service.ts` replace the `deriveCredentialSlug` body (lines ~49–55) with `slugify(label) || "credential"` from `@componode/core`
- [x] T009 [P] [US1] In `packages/importer-aws/src/importer.ts`, `packages/importer-azure/src/importer.ts`, `packages/importer-kubernetes/src/importer.ts`, and `packages/importer-mcp-server/src/importer.ts` delete each local `slugify` and import it from `@componode/core` (merge into the existing core import on line 1 of each file)
- [x] T010 [P] [US1] In `packages/importer-github/src/github-extras.ts` replace the two inline chains (lines ~56 and ~146) with `slugify(...)` imported from `@componode/core`
- [x] T011 [P] [US1] In `packages/importer-alibaba-cloud/src/mapping.ts` replace exported `slugify` (lines ~102–107) with a re-export/delegate to core, and update `componentSlug` (lines ~112–118) to use `slugify(…, SLUG_BASE_MAX)` semantics preserving the `"resource"`/`"id"` fallbacks and the existing 8-char suffix logic
- [x] T012 [US1] Add a comment at `packages/backend/src/services/user-service.ts:26` marking the username slugify as intentionally different semantics (allows `_`, charwise, no trim) per research D3 — do NOT migrate it
- [x] T013 [P] [US1] Rewrite `packages/frontend/src/ux/lib/slug.ts` `deriveSlug` with the same safe algorithm (collapse regex + index-trim — mirror of core, per research D8; `SLUG_RE` unchanged) and update `packages/frontend/src/ux/components/components/promote-form.tsx`, `packages/frontend/src/ux/components/products/product-form.tsx`, and `packages/frontend/src/ux/components/org/org-form-dialog.tsx` to import `deriveSlug` from `@/ux/lib/slug` instead of keeping local copies
- [x] T014 [US1] Add frontend unit test for `deriveSlug` parity — reuse the reference case table from `contracts/slug.md` in the frontend unit-test location used by `packages/frontend/src/test/unit/` (e.g. `slug.test.ts`); also assert `SLUG_RE` accepts every non-empty deriveSlug output
- [x] T015 [US1] Regression sweep: run `rg 'replace\(/\^-\+\|-\+\$/|\[\^a-z0-9\]' packages/ playwright/` and confirm the only remaining slug-chain site is the intentional `user-service.ts` username variant; run `pnpm --filter @componode/backend test` + each touched importer's test to confirm green

**Checkpoint**: CodeQL `js/polynomial-redos` pattern absent from all flagged files; all existing tests pass unchanged

---

## Phase 4: User Story 2 - OIDC issuer discovery fetch cannot be abused as an arbitrary network probe (Priority: P1)

**Goal**: `updateOidcConfig` validates issuer per `contracts/oidc-issuer.md` before any fetch; discovery body size-bounded

**Independent Test**: New integration tests in `packages/backend/test/integration/` assert every rejected matrix row returns 422 `OIDC_DISCOVERY_FAILED` **and** `fetch` is never called (spy assertion); accepted rows still reach the mocked discovery

### Tests for User Story 2

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

- [x] T016 [US2] Write failing tests in `packages/backend/test/integration/oidc-issuer-validation.test.ts` (model on `oidc.test.ts` fetch-spy pattern): (a) `ftp:`/`file:` scheme → 422, no fetch; (b) `http://10.0.0.1` non-loopback → 422, no fetch; (c) `https://user:pw@host` → 422, no fetch; (d) `?query`/`#frag` → 422, no fetch; (e) `http://localhost:8080`, `http://127.0.0.1`, `http://[::1]` → fetch attempted (accepted); (f) valid `https:` issuer → fetch attempted; (g) discovery response `content-length` > 64 KiB or body > 64 KiB → 422; (h) `enabled: false` path unchanged
- [x] T017 [P] [US2] Extend `playwright/tests/auth/oidc.spec.ts` with an admin-authenticated case: PUT `/api/v1/settings/oidc` with a non-loopback `http:` issuer → expect 422 `OIDC_DISCOVERY_FAILED` (API-level case is sufficient; the settings UI surfaces `e.message` already)

### Implementation for User Story 2

- [x] T018 [US2] In `packages/backend/src/services/settings-service.ts` add issuer validation in `updateOidcConfig` after the existing trailing-slash normalization (~line 193): `new URL()` parse → require `https:` OR (`http:` AND hostname ∈ `{localhost, 127.0.0.1, [::1]}`) → reject `username`/`password`/`search`/`hash` — throw `OIDC_DISCOVERY_FAILED` (422) before the fetch, per `contracts/oidc-issuer.md`
- [x] T019 [US2] In the same function bound the discovery body (~line 196): reject when `content-length` > 64 KiB and read the body with a 64 KiB cap before `JSON.parse` — map cap failures to `OIDC_DISCOVERY_FAILED`
- [x] T020 [US2] Verify `docs/openapi.yaml` and `docs/api.md` need no regeneration (endpoint shape unchanged) or regenerate via `pnpm --filter @componode/backend docs:api` if the `PUT /settings/oidc` description changes

**Checkpoint**: CodeQL `js/request-forgery` is either cleared by the new validation gate or ready for justified dismissal; T016/T017 green

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Full verification + docs alignment

- [x] T021 [P] Update `docs/security.md` (or the OIDC section of the relevant `docs/` guide) documenting the issuer scheme/loopback/userinfo rules and the 64 KiB discovery bound; keep single-source-of-truth (link, don't duplicate)
- [x] T022 Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build` at repo root — must be green
- [x] T023 Run docs checks: `pnpm --filter @componode/backend docs:api:check docs:importers:check docs:schema:check docs:sidebar:check docs:oracle:check` — must be green
- [x] T024 Run targeted e2e: `cd playwright && pnpm e2e -- --grep "oidc"` — green
- [x] T025 Final alert-pattern audit: `rg 'replace\(/\^-\+\|-\+\$/' packages/` → zero matches outside `user-service.ts`; `rg 'fetch\(discoveryUrl' packages/backend/src` → fetch only after validation gate

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on T001 — BLOCKS US1
- **US1 (Phase 3)**: depends on T003/T004 (core slugify exists + built)
- **US2 (Phase 4)**: independent of US1 — can run in parallel once Phase 1 completes
- **Polish (Phase 5)**: depends on US1 + US2

### User Story Dependencies

- **US1 (P1)**: needs Foundational (core util). No dependency on US2.
- **US2 (P1)**: fully independent — touches `settings-service.ts` only; can start immediately after Phase 1.

### Within Each User Story

- US1: T005 first (backend delegation), then all [P] migrations parallel
- US2: T016 (failing tests) → T018/T019 → T020
- Frontend mirror (T013/T014) independent of backend migration

### Parallel Opportunities

- T002/T003 sequential (test-first), then T005 → T006–T010, T013 in parallel
- US2 entirely parallel to US1
- T021 doc task parallel to verification

---

## Parallel Example: User Story 1

```bash
# After T005 lands, migrate all consumers concurrently:
Task: "product-service.ts toSlug → core"
Task: "org-service.ts toSlug → core"
Task: "credential-service.ts deriveCredentialSlug → core"
Task: "4 importer files → core import"
Task: "github-extras ×2 → core"
Task: "alibaba mapping.ts → core"
Task: "frontend ux/lib/slug.ts + 3 forms"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 baseline → Phase 2 canonical util
2. US1 migrations + regression sweep → independently verifiable (9 CodeQL findings' pattern gone)
3. US2 can land in the same branch since both are P1 and share the merge window

### Incremental Delivery

1. Baseline + core util → US1 → verify slug chain gone
2. US2 → verify issuer gate
3. Polish → full suite + docs + e2e
