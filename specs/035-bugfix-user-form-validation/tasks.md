# Tasks: user-creation form validation detail

## Phase 1 — Regression tests (failing first)

- [x] T001 Add `fieldErrors` cases to `packages/frontend/src/test/unit/api-client.test.ts` (invalid-params payload from bug report → `{password: "Password must be at least 12 characters"}`; details-object fallback; non-validation → `{}`)
- [x] T002 Add `packages/frontend/src/test/unit/invite-user-dialog.test.tsx` — mocked failing `useCreateUser` renders `FieldError` text + `data-invalid` on password; `new RegExp(pattern,"v")` does not throw; `minLength===12`; non-validation error toasts `describeApiError` text

## Phase 2 — Implement

- [x] T003 Add `fieldErrors(err)` to `packages/frontend/src/api/client.ts` (invalid-params → name:reason; details array → path:message; details object map)
- [x] T004 Update `invite-user-dialog.tsx`: field-error state, `FieldError`/`data-invalid`/`aria-invalid` per field, `onChange` clears field error, toast via `describeApiError` for unmapped/non-validation errors; `pattern="[a-z0-9_\\-]+"`; `minLength={PASSWORD_MIN_LENGTH}`

## Phase 3 — Docs & ship

- [x] T005 Add `.changeset/bugfix-user-form-validation-035.md` (`@componode/frontend` patch)
- [x] T006 Bump gap-registry queue `035`→`036` for the G13 spec; add `035-bugfix-user-form-validation` to `docs/roadmap.md` shipped list
- [x] T007 `pnpm lint && pnpm typecheck && pnpm test --filter=@componode/frontend` green; PR to `main`
