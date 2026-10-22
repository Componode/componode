# Contract: Agent-local operations listener

Process-local HTTP surface on the agent (research D1–D3). GET-only,
unauthenticated, network-policy-restricted — same posture as the hub's
`/metrics`. Serves state and numeric counters only.

## Configuration

| Variable | Default | Effect |
|---|---|---|
| `AGENT_OPS_HOST` | `0.0.0.0` | Bind address (`127.0.0.1` for local-only) |
| `AGENT_OPS_PORT` | `9464` | Listen port |
| `AGENT_OPS_DISABLED` | unset | `"true"` disables the listener entirely |

Listener start/bind failure → warn log, agent continues (FR-005).

## Endpoints

### `GET /healthz` — liveness

`200` once config is loaded and the process is running — including during
reconnect backoff. Body: `{ "status": "ok", "uptimeSeconds": <int> }`.

Consumed by the image `HEALTHCHECK` (see Dockerfile.agent) and any
orchestrator liveness probe.

### `GET /readyz` — readiness

Stream established (post-`hello.ok`):

```json
{ "ready": true, "state": "connected", "activeJobs": 1 }
```

Otherwise `503`:

```json
{ "ready": false, "state": "connecting" | "backoff" | "no-credential" }
```

### `GET /metrics` — Prometheus exposition

Content-Type `text/plain; version=0.0.4`. Series (research D7):

| Series | Type | Labels |
|---|---|---|
| `agent_stream_connected` | gauge | — |
| `agent_sessions_total` | counter | `reason` |
| `agent_reconnects_total` | counter | `outcome` (`established`\|`failed`) |
| `agent_jobs_received_total` | counter | — |
| `agent_jobs_completed_total` | counter | `result` |
| `agent_jobs_active` | gauge | — |
| `agent_assets_streamed_total` | counter | `importer` |
| `agent_credential_tests_total` | counter | `result` |
| `agent_secret_resolution_failures_total` | counter | — |
| default process metrics | — | `process_*`, `nodejs_*` |

### All other paths

`404 { "error": "not found" }`. Non-GET methods → `405`.

## Container healthcheck

`Dockerfile.agent` gains:

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "const h=process.env.AGENT_OPS_HOST;let host=h&&h!=='0.0.0.0'&&h!=='::'?h:'127.0.0.1';if(host.includes(':'))host='['+host+']';fetch('http://'+host+':'+(process.env.AGENT_OPS_PORT||'9464')+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
```

The check honors `AGENT_OPS_HOST`: a non-wildcard bind address is queried
directly (IPv6 addresses are bracketed for URL correctness);
`0.0.0.0`/`::`/unset fall back to loopback `127.0.0.1`.

Documented trade-off (FR-006): disabling the listener leaves the
healthcheck failing — operators who disable it must override/remove the
`HEALTHCHECK` in their deployment.
