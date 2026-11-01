# Agent Frame Contract — URL Check Probes (spec 051)

New frame family in `packages/core/src/contracts/agent-protocol.ts`, modeled
on `credential.test`/`credential.test.result`. Correlation is by payload
`probeId` (not envelope `runId` — probes are not import runs).
`AGENT_PROTOCOL_VERSION`: 3 → **4** (lockstep; hub+agent deploy together).

## `url_check.probe` (hub → agent)

```json
{
  "type": "url_check.probe",
  "payload": {
    "probeId": "<uuid>",
    "url": "https://api.example.test/health",
    "method": "GET | HEAD",
    "timeoutMs": 30000,
    "authMode": "NONE | BASIC | BEARER | CUSTOM_HEADERS",
    "authKeyNames": { "usernameKey": "...", "passwordKey": "...",
                      "tokenKey": "...",
                      "headers": [{"name": "...", "key": "..."}] },
    "secretRefMap": { "username": "env:API_USER", "...": "..." }
  }
}
```

- `secretRefMap` carries **reference names only** (ADR-117) — never values.
- `authKeyNames` names the credential keys the agent must resolve.
- URL re-validated against `urlSafetyError` on the agent before fetching
  (ADR-106 run-time validation).

## `url_check.probe.result` (agent → hub)

```json
{
  "type": "url_check.probe.result",
  "payload": {
    "probeId": "<uuid>",
    "outcome": "SUCCESS | FAILURE",
    "httpStatus": 200,
    "durationMs": 182,
    "errorType": "DNS | CONNECT | TLS | TIMEOUT | HTTP_STATUS |
                  POLICY_BLOCKED | ABORTED | OTHER"
  }
}
```

## Hub behavior

- `AgentSessionService.dispatchUrlCheckProbe(agentId, payload)` — pending map
  keyed by `probeId`, dispatch timeout, `AGENT_OFFLINE` (503) when the agent
  is not connected; pending entries reject on session close (same cleanup as
  `dispatchCredentialTest`).
- Result → write `url_check_observations` (`vantage='AGENT'`,
  `agentId` set). Dispatch failure/timeout → observation with `outcome=
  'MISSED'`, `errorType='AGENT_OFFLINE'` (or `TIMEOUT`).

## Agent behavior

- `client.ts` routes `url_check.probe` → `probe.ts` handler: resolve
  `secretRefMap` via `resolveRefMap` (env/file resolvers — values stay local),
  build auth headers per `authMode`/`authKeyNames`, run
  `executeHttpProbe` (shared `core` module), reply `url_check.probe.result`.
- Secret values never appear in frames, logs, or results.
