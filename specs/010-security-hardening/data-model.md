# Data Model: Security Hardening

Only the `sessions` table changes shape. Everything else is behavioral.

## sessions (migration `009_session_token_hash`)

| Column | Type | Change |
|---|---|---|
| `id` | `text` PK | Semantics change: stores `sha256hex(session token)` instead of the raw bearer token |
| `publicId` | `uuid` unique | Unchanged (non-secret client-facing identifier) |
| `userId` | `uuid` FK → persons | Unchanged |
| `tokenLast4` | `char(4)` NOT NULL | **New** — last 4 chars of the raw token, captured at creation for UI display |
| `createdAt` / `lastSeenAt` / `expiresAt` / `revokedAt` | `timestamptz` | Unchanged |

Migration steps:

1. `ALTER TABLE sessions ADD COLUMN tokenLast4 char(4)` (nullable first).
2. `UPDATE sessions SET revokedAt = now() WHERE revokedAt IS NULL` — all
   pre-existing sessions are revoked (forces re-login; avoids backfilling
   hashes via `pgcrypto`).
3. Backfill `tokenLast4 = right(id, 4)` for the historical rows so old list
   rows still render, then `SET NOT NULL`.

## Validation rules introduced (no schema change)

- `app_settings` effective set: `allowSelfRegistration = true` and
  `defaultUserRole = "ADMIN"` is an invalid combination — rejected on write,
  clamped at registration time.
- `importer_configs.secretRefs` — response projection masks `env`/`file`;
  `file` values must resolve inside `SECRETS_DIR` at resolution time.
- `web-url`/`api-url` `scope.url` — must be `http(s)` and not resolve to a
  local/private/link-local literal (core `url-safety` validation).

## Relationships / invariants preserved

- `sessions.id` remains the PK and lookup key (now a hash); no other table
  references `sessions.id` — safe to change semantics.
- `password_reset_tokens.tokenHash` already uses `hashToken`; sessions align
  to the same pattern.
