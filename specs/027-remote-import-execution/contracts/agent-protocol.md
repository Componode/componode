# Contract: Agent job execution frames (spec 027)

Extends `contracts/agent-protocol.md` from spec 025/026 and will land in
`docs/agent-protocol.md`. Envelope shape is unchanged:
`{type, runId?, payload}` — `runId` correlates every job frame; one job =
one run.

## Frame payloads

### `job.assign` — hub → agent

```json
{
  "type": "job.assign",
  "runId": "<uuid>",
  "payload": {
    "importerName": "kubernetes",
    "scope": { "...": "config.scope verbatim" },
    "secretRefMap": { "token": { "env": "PROD_TOKEN" } }
  }
}
```

- `importerName` — registered importer name (`^[a-z0-9-]+$`, ≤100).
- `scope` — `importer_configs.scope` verbatim (`Record<string,unknown>`).
- `secretRefMap` — merged `Record<keyName,{env}|{file}>` across the
  config's `AGENT_MANAGED` credentials (`secretRefMapSchema`; may be
  `null`/absent when no credentials are linked). **Names, never values.**

### `job.ack` — agent → hub

```json
{ "type": "job.ack", "runId": "<uuid>", "payload": { "accepted": true } }
{ "type": "job.ack", "runId": "<uuid>", "payload": { "accepted": false, "reason": "importer \"x\" not compiled" } }
```

- `accepted:boolean` + optional `reason` (≤500). `accepted:false` is the
  NACK. The hub maps the NACK reason: reason beginning with
  `SECRET_RESOLUTION_FAILED` → run `FAILED` with that errorType; anything
  else → `FAILED`/`AGENT_INCOMPATIBLE` with the reason echoed.

### `asset.batch` — agent → hub

```json
{ "type": "asset.batch", "runId": "<uuid>", "payload": { "assets": [ {DiscoveredAsset}, … ] } }
```

- ≤100 assets or ~1 MB serialized, whichever first (agent-side duty).
- Hub validates each asset via `validateDiscoveredAssetDetailed`; invalid
  assets → `VALIDATION_FAILED` run errors, run continues (the agent
  forwards every yielded asset — no agent-side filtering).

### `phase` — agent → hub

```json
{ "type": "phase", "runId": "<uuid>", "payload": { "name": "Fetching nodes" } }
```

- `name` ≤200 chars → `import_runs.currentPhase` verbatim.

### `run.error` — agent → hub (per-asset, non-fatal)

```json
{ "type": "run.error", "runId": "<uuid>",
  "payload": { "assetExternalId": "deploy/prod/api", "errorType": "ASSET_TOO_LARGE",
               "errorMessage": "asset exceeds 1 MB frame cap" } }
```

- Inserts one `import_run_errors` row; the run continues.

### `run.complete` — agent → hub (terminal)

```json
{ "type": "run.complete", "runId": "<uuid>", "payload": { "result": "COMPLETED" } }
{ "type": "run.complete", "runId": "<uuid>", "payload": { "result": "CANCELLED" } }
{ "type": "run.complete", "runId": "<uuid>",
  "payload": { "result": "FAILED", "errorType": "RUNTIME_ERROR",
               "errorMessage": "<sanitized>" } }
```

- `result` ∈ `COMPLETED|CANCELLED|FAILED` (enum, strict). `FAILED` carries
  optional `errorType`/`errorMessage` (≤2000, `maskSecretValues` applied
  agent-side before send).
- `COMPLETED` → hub reconcile + suggestions, then `COMPLETED`.
- `CANCELLED`/`FAILED` → terminal directly (no reconcile), matching
  in-process semantics.

### `cancel` — hub → agent

```json
{ "type": "cancel", "runId": "<uuid>", "payload": { "runId": "<uuid>" } }
```

- Agent aborts the job's cancellation token; the resulting
  `run.complete{result:"CANCELLED"}` is the confirmation.

## Ordering & state rules

```text
hub:   job.assign ───────────────▶ agent
agent: job.ack (accepted) ───────▶ hub → RUNNING
agent: {phase | asset.batch | run.error}*  (any order, only while ACKED)
agent: run.complete ─────────────▶ hub → terminal
hub:   cancel (any time after assign) → agent aborts → run.complete{CANCELLED}
```

- `asset.batch`/`phase`/`run.error`/`run.complete` for a run the hub never
  assigned on that session → protocol violation (error + close 1008), same
  rule as today for unhandled frames.
- The same frames for a run the hub **already finalized** on that session
  (ack-timeout, cancel, dead-run) → discarded (warn-log) — a zombie agent
  job must not take down the session and its collateral runs.
- `job.ack` for an unassigned or dead runId → ignored (warn-log) — a late
  ack after ack-timeout/disconnect must not resurrect anything.
- Heartbeat carries real `currentJobs`/`activeRunIds` (informational;
  dispatch gating uses the hub's in-flight map).
- Disconnect → hub fails every in-flight run on that session
  `AGENT_LOST`; agent aborts every local job. No resume.
