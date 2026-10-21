# Quickstart: Agent-Managed Credentials (spec 026)

Validation scenarios proving the feature end-to-end. References:
[spec.md](./spec.md) · [data-model.md](./data-model.md) ·
[contracts/](./contracts/)

## Prerequisites

- Repo dependencies installed (`pnpm install`), Postgres via testcontainers
  for integration tests (Docker running).
- For the live walkthrough: a running hub (`pnpm --filter backend dev` or
  the Docker Compose stack) plus the agent image from spec 025
  (`docker build -f Dockerfile.agent -t componode-agent .`).

## 1. Automated gates

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Feature-specific coverage (written failing-first per constitution VI):

- `packages/backend/test/integration/credentials-agent-managed.test.ts` —
  create/read/update/delete of the AGENT_MANAGED kind, schema rejection of
  `secrets` on that kind, `keyHints` = source-type hints, `kind` immutable,
  revoke/delete-in-use unchanged.
- `packages/backend/test/integration/credential-kind-binding.test.ts` —
  kind-mismatch rejection both directions (agent-bound config simulated by
  direct `agentId` insert — spec-025 precedent), OIDC STORED-only check,
  `resolveImportSecrets` defense-in-depth.
- `packages/backend/test/integration/credential-test-remote.test.ts` —
  dispatch over a real loopback WS session: result routing by `testId`,
  `AGENT_OFFLINE`, `AGENT_TEST_TIMEOUT`, `CREDENTIAL_NO_BOUND_AGENT`,
  mid-test disconnect, audit rows (`credential_test_dispatched`,
  `tested`), `lastUsedAt` stamp.
- `packages/agent/test/*` — `credential.test` handler: env resolution,
  file resolution under `SECRETS_DIR`, traversal/absolute rejection,
  missing `testSecrets`, no values in emitted logs or frames.
- `packages/core` — `secretRef`/ref-map schema validation and the shared
  resolver moved from backend (behavior identical on both sides).

## 2. Live walkthrough (hub + agent)

```bash
# Agent host: provide a secret the reference will resolve
docker run -d --name componode-agent \
  -e HUB_URL=https://hub.example.com \
  -e AGENT_TOKEN_FILE=/run/secrets/agent-token \
  -e PROD_GH_TOKEN=ghp_example \
  -v ./agent-token:/run/secrets/agent-token:ro \
  -v componode-agent-state:/state \
  componode-agent:latest
```

1. Admin → Credentials → create → "Resolved on an Import Agent" →
   `token → env: PROD_GH_TOKEN`. Verify: badge on the row, key hint shows
   `env`, no value field anywhere.
2. Attempt to link it to a hub-executed importer config →
   `CREDENTIAL_KIND_MISMATCH` (binding arrives in 027 — the rejection is
   the in-scope behavior now).
3. Integration tests cover the full remote-test path against the latent
   dispatch surface (direct `agentId` binding) — see §1.
4. Rotation: change `PROD_GH_TOKEN` on the agent host only — no hub edit;
   next resolution uses the new value.

## 3. Expected outcomes (maps to Success Criteria)

- No secret value appears in any API response, DB row, log, audit entry,
  or agent→hub frame — only reference names (SC-002).
- Remote test always terminates: result, `AGENT_OFFLINE`,
  `AGENT_TEST_TIMEOUT`, or `CREDENTIAL_NO_BOUND_AGENT` (SC-003).
- Path escapes and unset env vars fail closed naming key + source (SC-004).
- Kind-mismatched bindings rejected at save (SC-006).
