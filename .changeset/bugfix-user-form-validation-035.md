---
"@componode/frontend": patch
---

User-creation dialog surfaces server validation detail (bugfix 035): VALIDATION_FAILED `invalid-params`/`details` render inline per field instead of a bare "Invalid input" toast; the username `pattern` is escaped for the `v` flag so client-side validation runs again; password `minLength` matches `PASSWORD_MIN_LENGTH` (12).
