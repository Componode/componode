# Quickstart: Remote Import Execution (spec 027)

Validates the feature end-to-end: bind → dispatch → stream → complete,
plus the failure matrix. Two layers: automated tests, then a manual
smoke run.

## 1. Automated validation

```bash
pnpm install && pnpm build   # core contracts build first

# unit — schemas, dispatcher, executor, binding validation, recovery
pnpm --filter @componode/core test
pnpm --filter @componode/backend test:unit
pnpm --filter @componode/agent test

# integration — testcontainers Postgres + real ws agent client
pnpm --filter @componode/backend test
```

Key suites: `remote-run.test.ts` (dispatch/stream/complete parity),
`remote-run-failures.test.ts` (offline timeout, NACK, disconnect
`AGENT_LOST`, `ASSET_TOO_LARGE`, cancel, hub-restart recovery),
`config-agent-binding.test.ts` (save-time validation matrix),
`agent/executor.test.ts` (batching, abort, resolution failure).

## 2. Manual smoke (two terminals + a browser)

Prereqs: `docker compose up` hub + Postgres; admin login.

1. Admin → Import Agents → create `smoke-agent` → copy the install command.
2. Terminal 2: run the agent container (or `pnpm --filter @componode/agent
   dev` with `HUB_URL`/`AGENT_ENROLLMENT_TOKEN`); confirm `Connected`.
3. Credentials → new `AGENT_MANAGED` credential for the `web-url`
   importer (`{ "url": { "env": "SMOKE_TARGET_URL" } }` — or a `file` ref
   under `SECRETS_DIR`).
4. Importers → new `web-url` config → **Execution** = `Agent: smoke-agent`
   → select the agent-managed credential → save. Card shows
   `Runs on: smoke-agent`.
5. Trigger a run → run detail shows `Waiting for agent smoke-agent`
   briefly, then `Ran on agent smoke-agent`, and completes with components
   discovered.
6. Stop the agent container mid-run on a second trigger → run fails
   `AGENT_LOST` within ~90 s; dashboard shows the
   `OFFLINE_AGENT`-with-bound-configs attention item.
7. Rebind the config to `This hub` → next run is in-process again.

## Expected outcomes

- Catalog content from the remote run is identical in shape to an
  in-process run (components, instances, `lastSeenInRunId`, run errors,
  edge suggestions staged).
- No secret value appears in any frame, hub log, agent log, or run record —
  only reference names.
- The agent never receives more concurrent `job.assign` frames than its
  `MAX_JOBS`.
- Every remote run reaches a terminal state; none hangs PENDING/RUNNING.
