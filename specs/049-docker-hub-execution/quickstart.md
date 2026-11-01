# Quickstart Validation: Docker Hub execution

## Prerequisites

- Backend test database migrations applied.
- No Docker socket is required for the default deployment checks; transport tests use mocked Docker clients/fixtures.
- For optional live validation, provision a reachable Docker Engine and matching `STORED` credential keys.

## Validation scenarios

1. **Target CRUD and audit**
   - Create a socket target, list it, edit label/description, disable, re-enable, and verify Activity entries carry the target label and non-secret route summary.
   - Expected: create/update/enable/disable events are audited; no secret values appear.

2. **Hub config and run preflight**
   - Create a Hub-bound Docker config selecting the target and run it.
   - Expected: target resolution happens before Docker access; Source identity is `docker-engine:{/info.ID}` (or configured fallback).

3. **Credential-key coverage**
   - Create an mTLS or SSH target and save a Hub config whose `STORED` credential lacks one `*Key`.
   - Expected: save fails `CREDENTIAL_MISSING_KEY`; no run is created.

4. **Disabled lifecycle**
   - Disable a target referenced by a saved config, trigger that config, and inspect the run.
   - Expected: a retained `FAILED` run with `errorType: TARGET_DISABLED`; no Docker calls.

5. **Disable cancellation**
   - Start a Hub run/test, disable its target, and inspect results.
   - Expected: run is `CANCELLED` with `cancelReason: TARGET_DISABLED`; test returns a failed disabled-target result; manual cancellation still reports `USER_REQUESTED`.

6. **Agent regression**
   - Keep an existing Agent-bound config and run it with its local `docker-targets.json` profile.
   - Expected: unchanged Agent behavior and protocol; the same Engine ID maps to the same ImporterSource.

7. **API/docs contract**
   - Run the API docs contract test and regenerate `docs/api.md`.
   - Expected: every target route has matching OpenAPI `x-permission` metadata; run schema includes `cancelReason`; Docker/deployment docs describe Hub setup and no default socket mount.

## Commands

```bash
pnpm install
pnpm --filter @componode/backend test
pnpm --filter @componode/importer-docker test
pnpm --filter @componode/agent test
pnpm --filter @componode/frontend test
pnpm build
```
