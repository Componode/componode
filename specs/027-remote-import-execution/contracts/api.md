# Contract: REST surface deltas (spec 027)

All changes land in `docs/openapi.yaml` (ADR-104) and regenerate
`docs/api.md` via `pnpm docs:api`. Permissions follow the existing
`x-permission` contract.

## `POST /api/v1/importer-configs` — request + response

Request schema `createImporterConfigSchema` gains:

| Field | Type | Notes |
|---|---|---|
| `agentId` | `uuid \| null` (optional) | `null`/absent = in-process |

Response `config` gains `agentId` and:

```json
"agent": { "id": "<uuid>", "name": "eu-k8s-prod", "status": "CONNECTED" } | null,
"agentIncompatible": false
```

Errors added: `404 AGENT_NOT_FOUND` (unknown agentId),
`400 AGENT_INCOMPATIBLE` (revoked agent or `allowedImporters` misses the
importer — message names agent + importer).

## `PATCH /api/v1/importer-configs/{id}` — same additions

`agentId` is settable and clearable (`null` → in-process). Changing the
executor re-validates the effective credential set with the new executor
kind (spec-026 `CREDENTIAL_KIND_MISMATCH` rules).

## `GET /api/v1/importer-configs[/…]` — responses

Same `agent`/`agentIncompatible` fields on list and detail rows.

## `GET /api/v1/agents/{id}/configs` — NEW

`x-permission: agent:read`. Response:

```json
{ "configs": [
  { "id", "label", "importerName", "schedule", "enabled",
    "agentIncompatible": true } ] }
```

## `GET /api/v1/agents/{id}/runs` — NEW

`x-permission: agent:read`. Latest 50 runs executed on the agent:

```json
{ "runs": [ { "id", "configId", "configLabel", "status", "createdAt",
              "startedAt", "completedAt", "errorType",
              "assetsProcessed", "currentPhase" } ] }
```

## `GET /api/v1/agents/{id}` — response gains

```json
"activeRuns": [ { "runId", "configId", "configLabel", "state",
                  "phase", "startedAt" } ]
```

## `GET /api/v1/agents` — row gains `runningJobs: number`

## Run responses — `GET …/runs/…` payloads gain

`agentId: uuid | null`, `agentName: string | null` (join to
`import_agents`; `null` name when the agent row is gone).

## Dashboard — `AttentionItem.kind` gains `OFFLINE_AGENT`

`label`: `"<agent name>"`, `href`: `/agents/{id}`.

## `ERROR_CODES` additions

`AGENT_LOST`, `AGENT_UNAVAILABLE`, `AGENT_INCOMPATIBLE`, `ASSET_TOO_LARGE`
(API-level uses: `AGENT_INCOMPATIBLE` + `AGENT_NOT_FOUND` on config save;
`AGENT_UNAVAILABLE` is a run outcome, not an HTTP code — recorded in
`import_runs.errorType`, listed in the enum per ADR-071).

## Metrics additions

`agent_jobs_total{agent,result}` —
`result ∈ completed|failed|cancelled|lost|unavailable|incompatible`;
`agent_assets_received_total{agent,importer}`.
