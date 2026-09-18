# Quickstart: Credential Store validation

**Feature**: `013-credential-store` | **Date**: 2026-09-18

Runnable end-to-end scenarios proving the feature works. Prerequisites:
repo deps installed (`pnpm install`), Postgres available (testcontainers for
integration tests; `docker compose up` for manual validation).

## Automated validation

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Targeted suites that must pass (test-first: written before implementation):

- `packages/backend/test/unit/credential-crypto.test.ts` — encrypt/decrypt
  round-trip, tamper detection, wrong-key failure, keyVersion tagging,
  key bootstrap order (env → file → auto-generate), rotation re-encrypt.
- `packages/backend/test/unit/secret-resolver.test.ts` — credential merge,
  legacy env/file resolution, collision + missing-key errors, revoked/missing
  credential failures, deprecation flag.
- `packages/backend/test/unit/credential-service.test.ts` — slug derivation,
  key-hint masking (short values masked entirely), service helpers.
- `packages/backend/test/integration/credential-store.test.ts` — CRUD,
  dependents + 409 delete, junction integrity, run records `credentialIds`
  + `lastUsedAt`, convert-secrets flow, OIDC credential resolution, boot-fail
  when credentials exist without key.
- Importer manifest tests ×7 — `secrets` declaration present; github
  `testSecrets` happy/failure paths.
- Existing API-docs contract test — covers new routes vs `openapi.yaml`.

## Manual scenario 1 — Paste-a-PAT flow (US1+US2)

1. `docker compose up` → log in as admin.
2. Settings → Credentials → New: label `GitHub PAT`, key `token`, paste PAT →
   save. List shows the credential with hint `…<last4>` only.
3. Importers → New config → GitHub → pick credential `GitHub PAT` (no env
   vars) → save → Run now.
4. **Expected**: import authenticates and completes; run detail lists the
   credential used; credential `lastUsedAt` updated.

## Manual scenario 2 — Write-only + lifecycle (US3+US4)

1. `GET /api/v1/credentials/:id` → response has `keyHints`, never `token`.
2. Test button → `{ok: true}`; rotate with a bad value → test → `{ok:false}`.
3. Revoke credential → run config → fails fast naming the credential.
4. Try delete while referenced → `409` listing dependent configs; remove
   reference → delete succeeds.

## Manual scenario 3 — Deprecation + convert (US5)

1. On a config created with `secretRefs: [{key:"token", env:"GH_TOKEN"}]`
   (env var set in compose) → run succeeds; config shows DEPRECATED badge.
2. Click "Convert to stored credential" → new credential created, config
   re-pointed, runs keep working. Unset `GH_TOKEN` → still works.

## Manual scenario 4 — Key ops (US6)

1. Fresh boot with no `COMPONODE_SECRETS_KEY` → `master.key` appears under
   `SECRETS_DIR`; credential create works.
2. Delete `master.key`, restart with credentials present → boot fails loudly.
3. Restore, rotate: set new key in `COMPONODE_SECRETS_KEY`, old in
   `COMPONODE_SECRETS_KEY_PREVIOUS`, restart → credentials still resolve;
   `keyVersion` bumped; unset `..._PREVIOUS`.
