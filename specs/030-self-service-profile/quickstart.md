# Quickstart: Validate Self-Service Profile Update

## Prerequisites

- Stack running (`docker compose up` or `pnpm dev` across packages).
- A non-admin account (EDITOR or VIEWER role) plus an admin account.

## API checks

```bash
# 1. Non-admin self-edit succeeds (was 403 before this feature)
curl -X PATCH https://localhost:8443/api/v1/users/me \
  -b session.jar -H "Content-Type: application/json" \
  -d '{"displayName":"New Name","email":"new@example.com"}'
# expect: 200 { "user": { "displayName":"New Name", "email":"new@example.com", … } }

# 2. Privileged field is rejected, nothing partially applies
curl -X PATCH …/users/me -d '{"role":"ADMIN"}'
# expect: 400 VALIDATION_FAILED; role unchanged on GET /users/me

# 3. Unauthenticated is rejected
curl -X PATCH …/users/me -d '{"displayName":"X"}'   # no session cookie
# expect: 401 AUTH_NO_SESSION

# 4. Audit attribution
# admin: GET /api/v1/activity — latest entry shows the non-admin user as
# actor of a "user" entity change with the modified fields.
```

## UI check

1. Sign in as the non-admin user → Settings → Profile.
2. Display name and email fields are editable; Save succeeds with a
   toast; no "Only workspace admins can update profiles" footer note.
3. Reload — values persist; top-bar/sidebar identity updates without
   re-login.

## Automated

- `pnpm --filter @componode/backend test` — route tests cover 200/400/401
  and the privileged-field rejection.
- `pnpm --filter @componode/frontend test` — profile page test covers the
  editable non-admin state.
- OpenAPI contract test passes with the new `patch /users/me` entry.
