# Quickstart: Agent Operations Observability

Validates the feature end-to-end on a dev checkout. Prereqs: repo built
(`pnpm install && pnpm build`), Postgres via `docker compose up -d db`,
hub running (`pnpm --filter @componode/backend dev`), an admin session.

## 1. Agent-local surfaces (US1)

```bash
# Terminal A — run the agent locally
HUB_URL=ws://localhost:3000 AGENT_TOKEN=<durable-token> \
  pnpm --filter @componode/agent dev

# Terminal B
curl -s http://localhost:9464/healthz   # → {"status":"ok","uptimeSeconds":N}
curl -s http://localhost:9464/readyz    # → {"ready":true,...} once connected
curl -s http://localhost:9464/metrics   # → agent_* + process_* series

# Disable check: AGENT_OPS_DISABLED=true → endpoints refuse; agent still works.
# Readiness check: stop the hub → /readyz returns 503 while /healthz stays 200.
```

Container variant: `docker build -f Dockerfile.agent -t componode-agent .`
then `docker inspect --format '{{.State.Health.Status}}' <container>` →
`healthy` once running (SC-001).

## 2. Agent-reported state on the hub (US2)

```bash
curl -s -b cookies.txt http://localhost:3000/api/v1/agents/<id> | jq .agent
# → reportedStatus{uptimeSeconds, jobs, assetsStreamed, ...}
#   lastHeartbeatAt refreshes ~every 30 s
#   lastDisconnectReason set after a session closes
```

UI: Administration → Import Agents → detail → Overview shows "Last
heartbeat" and an agent-reported counters block; an agent that never
reported shows "not reported by this agent" (FR-011).

## 3. Hub metrics (US3)

```bash
# Run a remote import on a bound config, then:
curl -s http://localhost:3000/metrics | grep -E \
  'agent_dispatch_wait_seconds|agent_remote_job_duration_seconds|agent_session_duration_seconds|agent_last_contact_timestamp_seconds'
```

## 4. Regression sweep

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Expected: agent unit tests cover the ops server + counters; backend
integration tests cover heartbeat→`"reportedStatus"` persistence, payload
deltas, and new series emission; openapi contract test passes (ADR-104).
