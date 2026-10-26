# Plan: user-creation form validation detail

## Approach

Frontend-only bugfix — the API payload is already correct (RFC 7807 `details[]`
zod issues + RFC 9457-style `invalid-params[] {name, reason}`). Three changes:

1. **`packages/frontend/src/api/client.ts`** — add `fieldErrors(err)`:
   `Record<string, string>` extracted from `invalid-params` (preferred —
   `{name, reason}`), falling back to the `details` array (`path.join(".")` →
   `message`) or a `details` object map. Keep `describeApiError` for toast text.
2. **`packages/frontend/src/ux/components/admin/invite-user-dialog.tsx`** —
   - `onError`: when `VALIDATION_FAILED`, `setErrors(fieldErrors(err))` and
     mark matching fields `data-invalid`/`aria-invalid` with `FieldError`
     (credential-form convention); toast once with `describeApiError` covering
     issues for fields not in the form and non-validation errors.
   - `pattern="[a-z0-9_-]+"` → `pattern="[a-z0-9_\\-]+"` (escaped `-`, valid
     under the `v` flag browsers apply to `pattern`).
   - `minLength={8}` → `minLength={PASSWORD_MIN_LENGTH}` from `@componode/core`.
   - Clear a field's error on edit (`onChange`) so re-submits aren't confused.

## Non-goals

- No backend change — the payload is already detailed enough.
- No sweep of other dialogs' `toast.error(e.message)` — out of scope; the new
  helper makes a later sweep mechanical.
- No ADR — no contract surface touched.

## Tests (regression-first)

- `src/test/unit/api-client.test.ts` / `problem-error.test.tsx`: `fieldErrors`
  on the exact payload from the bug report, `details`-object fallback,
  non-validation error → `{}`.
- `src/test/unit/invite-user-dialog.test.tsx`: submit with rejected
  `useCreateUser` → password `FieldError` shows "Password must be at least 12
  characters", `data-invalid` set; pattern attr compiles under `v`;
  `minLength === 12`; non-validation error still toasts.
