# Quickstart: Validate URL Check Agent-Vantage Probe Bounds (spec 052)

Runnable checks that prove the feature end-to-end. Commands run from
the repo root.

## Prerequisites

- `pnpm install` and a Postgres instance for integration tests
  (testcontainers; Docker available), per repo test conventions.
- Env overrides for manual runs (all optional, defaults in
  `docs/url-checks.md` / `docs/import-agents.md`):
  - Hub: `URL_CHECK_AGENT_CONCURRENCY=4`,
    `URL_CHECK_AGENT_RATE_LIMIT=20`, `URL_CHECK_AGENT_QUEUE_MAX=100`
  - Agent: `URL_CHECK_MAX_PROBES=8`

## Automated validation (primary)

```bash
pnpm --filter @componode/core test        # enum + frame schema tests
pnpm --filter @componode/backend test     # bounded-pool, cancel, MISSED(SATURATED), late-result tests
pnpm --filter @componode/agent test       # cap refusal, cancel-abort, close-abort-all tests
pnpm build && pnpm lint && pnpm typecheck
```

Key assertions these suites make:

1. **Bound**: dispatching more due agent-vantage checks than
   `URL_CHECK_AGENT_CONCURRENCY` never exceeds that many in-flight
   calls to the agent dispatch seam; a second agent's dispatches are
   unaffected (spec FR-001/005, US1).
2. **Deferral + overflow**: work beyond in-flight capacity waits and
   executes later with one observation each; beyond
   `URL_CHECK_AGENT_QUEUE_MAX` the slot lands `MISSED` with
   `errorType=SATURATED` (FR-003/004).
3. **Cancel**: a stubbed never-resolving agent dispatch causes the
   deadline to fire → `url_check.probe.cancel` is sent on the socket
   and the slot records `MISSED(TIMEOUT)` (FR-007/008/012).
4. **Late result**: a `url_check.probe.result` arriving after the
   pending entry settled produces no second observation (FR-011).
5. **Agent cap + refusal**: N+cap probe frames → exactly cap fetches
   run; the overflow frame gets an immediate `SATURATED` result
   (FR-006).
6. **Agent cancel/close**: a cancel frame aborts the in-flight fetch
   (errorType `ABORTED` internally); session close aborts all
   in-flight probes and sends nothing on the dead socket (FR-008/009).
7. **Constraint**: the observations `errorType` CHECK accepts
   `SATURATED` (check-constraint-helper test + migration 026).

## Manual smoke (optional)

1. Create an Agent-vantage monitoring setup with several checks whose
   cadence aligns (or set `URL_CHECK_AGENT_CONCURRENCY=1` and two
   checks due together) against a slow stub endpoint.
2. Watch the agent's `GET /metrics` (`agent_url_check_probes_in_flight`)
   — it never exceeds the cap; overflow surfaces as
   `agent_url_check_probes_total{result="saturated"}` and
   `url_check_probes_total{vantage="AGENT",errorType="SATURATED"}` on
   the hub.
3. Kill the agent mid-probe: the slot records `MISSED`/`AGENT_OFFLINE`
   once; reconnect sends a stale result — observation count stays 1.
