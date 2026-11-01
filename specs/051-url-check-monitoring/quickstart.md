# Quickstart — Validating URL Check Monitoring (spec 051)

## Prerequisites

- `pnpm install` at repo root; Postgres available (or use testcontainers for
  integration tests).
- Running backend (`pnpm --filter @componode/backend dev`) and frontend
  (`pnpm --filter @componode/frontend dev`); logged in as an EDITOR+ user.
- A reachable test URL (e.g. `https://example.com` or a local mock server —
  note ADR-106 blocks private/loopback literal IPs).

## Scenario 1 — Configure and observe a check (US1+US2+US3)

1. Open a Component with an instance → **URL checks** card → **Add check**.
   Name it, set URL `https://example.com`, pick the instance → save.
2. Check appears in the table; status shows `NO DATA` then updates after the
   first probe (cadence 5 min — set a shorter cadence override ≥60 s for
   quick validation).
3. Open the check detail (`components/:slug/checks/:checkId`): metrics cards
   show availability/error rate/p50·p95·p99 for 24h/7d/30d, labeled with
   window and "reachable from Hub"; observation table lists attempts.
4. Point a second check at a URL that returns 404 (or a blocked destination)
   → observations record `FAILURE`/`HTTP_STATUS` or a validation error at
   save — sibling check unaffected.
5. Importer-reported `ComponentInstance.status` and dashboard product health
   are unchanged by check failures.

## Scenario 2 — API auth (US4)

1. On an `API`-category Component, add a check → auth section appears:
   Bearer Token → select a Credential holding a `token` key.
2. Probe sends `Authorization: Bearer <resolved>`; API/UI never show the
   value; observation stores outcome only.
3. Try custom header name `Authorization` → rejected with a validation error.
4. On a `WEB_ENDPOINT` Component, no auth controls render.
5. Credential detail dependents list the check; deleting a referenced
   credential is blocked (`CREDENTIAL_IN_USE`).

## Scenario 3 — Create Component + checks (US5)

`/components/new` → fill Component fields, one instance, two check rows →
submit → lands on the new Component with both checks listed and probing.

## Scenario 4 — Agent vantage (US2, FR-021)

1. Set the Component's monitoring setup vantage to a connected Import Agent.
2. Checks show "reachable from <agent name>"; stop the agent → observations
   record `MISSED`/`AGENT_OFFLINE`; availability drops and a coverage gap is
   displayed.

## Automated validation

- `pnpm --filter @componode/core test` — probe executor + schemas.
- `pnpm --filter @componode/backend test` — service/migration/scheduler
  integration + `api-docs-contract` route/OpenAPI parity.
- `pnpm --filter @componode/frontend test` — check card/editor/detail tests.
- `pnpm --filter @componode/agent test` — probe frame handling.
- `pnpm docs:api` then `docs:api:check` — generated API docs in sync.
