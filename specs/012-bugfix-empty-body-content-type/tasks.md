# Tasks: Empty-Body Requests Sent With JSON Content-Type

**Input**: Design documents from `specs/012-bugfix-empty-body-content-type/`

**Prerequisites**: `spec.md` (required), `plan.md` (required)

**Tests**: Included. Test-first is required by the project constitution.

---

## Phase 1: Investigation

**Purpose**: Enumerate every affected call site and verify the contract.

- [x] T001 List all frontend `api()` calls using `POST`/`PUT`/`PATCH`/`DELETE`
  and classify which send no `body`.
- [x] T002 Cross-check each body-less endpoint against `docs/openapi.yaml` —
  confirm none declares `requestBody`.
- [x] T003 Confirm `apiFetch` is the only `fetch` call site in `src/` so a
  single fix covers all call sites.

---

## Phase 2: Regression Test

- [x] T004 Create `packages/frontend/src/test/unit/api-client.test.ts`:
  - body-less `POST` sends no `Content-Type`
  - body-less `DELETE` sends no `Content-Type`
  - `POST` with a body sends `Content-Type: application/json`

---

## Phase 3: Implementation

- [x] T005 Update `packages/frontend/src/api/client.ts` — set
  `Content-Type: application/json` only when `options.body` is present;
  keep `options.headers` override and CSRF-header behavior unchanged.

---

## Phase 4: Documentation & Decisions

- [x] T006 Create `specs/012-bugfix-empty-body-content-type/{spec.md,plan.md,tasks.md}`.
- [x] T007 ADR review — none required; no architecture decision changed
  (documented in `plan.md`).
- [x] T008 Record related out-of-scope finding (`/auth/oidc/login` reached via
  GET link) in `spec.md`.

---

## Phase 5: Validation

- [x] T009 Run `pnpm --filter @componode/frontend typecheck` — clean.
- [x] T010 Run `pnpm --filter @componode/frontend lint` — clean.
- [x] T011 Run `pnpm vitest run` on `api-client.test.ts` and
  `problem-error.test.tsx` — all pass.
- [x] T012 Verify `docker compose build` unaffected (frontend build clean).

---

## Phase 6: Branch & Merge Prep

- [x] T013 Commit to `bugfix/012-empty-body-content-type`.
- [ ] T014 Push branch and open a PR.

---

## Dependencies & Execution Order

- Phase 1 → Phase 2 → Phase 3 → Phase 5; Phase 4 parallel after Phase 3.
- The regression test (T004) fails against the pre-fix client and passes after
  T005.
