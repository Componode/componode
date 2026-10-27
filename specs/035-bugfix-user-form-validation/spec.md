# Bugfix: user-creation form swallows validation detail

## Problem

On **Administration → Users → New user** (`InviteUserDialog`), submitting an
invalid password produces an unclear failure:

- The browser console reports
  `Pattern attribute value [a-z0-9_-]+ is not a valid regular expression` —
  the username `pattern` is invalid under the `v` flag Chrome applies to the
  HTML `pattern` attribute (`-` inside a character class must be escaped), so
  client-side username validation silently never runs.
- The API correctly answers `400 VALIDATION_FAILED` with per-field detail in
  `details[]` (zod issues) and `invalid-params[]` (`{name, reason}`), but the
  dialog shows only `toast.error(err.message)` → the user sees the generic
  **"Invalid input"** with no indication of which field failed or why.
- The password field hints `minLength={8}` while `createUserSchema` requires
  `PASSWORD_MIN_LENGTH = 12` — the client-side floor is wrong, so the 400 is
  reachable at all.

## Root cause

- `pattern="[a-z0-9_-]+"` — unescaped `-` in a `v`-mode character class.
- `onError: (err) => toast.error(err.message)` discards `details` /
  `invalid-params`; `describeApiError` exists in `api/client.ts` but is unused,
  and no surface maps per-field errors onto `FieldError`/`data-invalid` (the
  convention already used by `credential-form.tsx`).
- `minLength={8}` drifted from the schema constant.

## Impacted user scenarios

- Admin creates a user with a short/invalid password → toast says "Invalid
  input"; must guess the cause.
- Admin enters an invalid username → no client-side check fires (pattern
  ignored); server 400 is equally opaque.
- Multiple invalid fields → only the generic message; nothing is field-bound.

## Acceptance criteria

- `VALIDATION_FAILED` responses render each `invalid-params`/`details` issue
  inline on the matching field (`data-invalid` + `FieldError` + `aria-invalid`),
  e.g. "Password must be at least 12 characters" under the password field.
- Issues naming a field not present in the form still surface (toast with the
  detailed text, not bare `message`).
- Non-validation errors keep the existing toast path with `describeApiError`
  detail instead of bare `err.message`.
- `pattern` compiles under the `v` flag (`new RegExp(pattern, "v")` does not
  throw) and rejects uppercase/space usernames client-side.
- Password `minLength` equals `PASSWORD_MIN_LENGTH` (12).
- Regression tests cover the payload shape from the bug report.
