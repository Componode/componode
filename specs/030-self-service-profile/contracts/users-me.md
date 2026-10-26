# Contract: `PATCH /api/v1/users/me`

Self-bound profile update. Target identity is the session's user — no
path parameter, no way to address another record.

**Auth**: `verifySession` (authenticated, any role). No `x-permission` —
same posture as `GET /users/me`.

## Request

```json
{
  "displayName": "Ada Lovelace",   // optional, string, ≤100 chars
  "email": "ada@example.com"       // optional, string, email format
}
```

Strict schema — unknown keys are rejected, not stripped (ADR-095).
Privileged keys (`role`, `isActive`, `teamId`, `username`, `password`,
`id`, …) therefore fail rather than silently no-op.

## Responses

| Status | Body | Condition |
|---|---|---|
| `200` | `{ user: Person }` | Updated record (also returned on empty-body no-op) |
| `400` | `{ code: "VALIDATION_FAILED", message, details }` | Invalid field value or unknown/privileged key |
| `401` | `{ code: "AUTH_NO_SESSION", message }` | No authenticated session |
| `404` | `{ code: "NOT_FOUND", message }` | Session user no longer exists |

Side effects: one audited `user` entity change attributed to the caller
(same shape as admin-initiated updates — FR-004). No session
invalidation; the caller stays signed in.

## Client wiring

- `useUpdateSelf()` → `api("/users/me", { method: "PATCH", body })`;
  invalidates `["auth", "session"]` and `["users"]`.
- OpenAPI: `patch` added under `/users/me` in `docs/openapi.yaml`;
  `docs/api.md` regenerated (`pnpm docs:api`) — ADR-104.
