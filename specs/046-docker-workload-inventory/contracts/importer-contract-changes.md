# Contract: importer-contract changes for `@componode/importer-docker`

**Feature**: `046-docker-workload-inventory` | **Status**: ratified text for ADR-121

## `ImporterManifest` additions (packages/core)

```ts
interface ImporterManifest {
  // ...existing fields (name, label, description, version, implPath,
  // configSchema, secrets, targetRefKey, reportsSourceIdentity)

  // When true, configs for this importer MUST be bound to an Import
  // Agent — create/update with agentId null is rejected, and in-process
  // dispatch refuses to run it (ADR-121). Absent = hub-or-agent per
  // existing rules.
  requiresAgent?: boolean;
}
```

Docker is the first `requiresAgent` importer. `targetRefKey: "targetId"`
is also set (ADR-056 A1).

## `testSecrets` signature (packages/core)

```ts
testSecrets?(
  secrets: Record<string, string>,
  config?: Record<string, unknown>,
  resolvedTarget?: unknown,
): Promise<CredentialTestResult>;
```

- `resolvedTarget` carries the preflight-resolved `TargetProfile` —
  populated only on agents when the manifest declares `targetRefKey`
  and the scope's named key holds an allowlisted `targetId`.
- In-process callers pass nothing; importers without `targetRefKey`
  receive `undefined`. Backward compatible — existing importers
  unaffected.
- The agent's `handleCredentialTest` performs the same
  `loadTargetProfile` preflight as `job.assign`: unknown/malformed/
  unprovisioned registry → `{ ok: false, error: <non-secret reason> }`
  (same `TARGET_RESOLUTION_FAILED` family as job NACKs — no new error
  code needed on the wire; the result frame is `{ok, error}`).

## Config-binding enforcement (packages/backend)

- `importer-config-service` create/update: when the resolved manifest
  has `requiresAgent === true` and `agentId` is absent/null →
  `400 VALIDATION` ("importer requires an Import Agent").
- Run dispatch: an in-process executor never receives a `requiresAgent`
  importer (the `resolveTarget` stub already throws; the config gate is
  the user-facing guard).
- Protocol unchanged — `credential.test` and `job.assign` payloads
  already carry `scope`; the target profile never crosses the wire
  (it is agent-local data passed to the importer in-process on the
  agent).

## Importer package wiring (lockstep — ADR-065 A1, ADR-116 #7)

- `IMPORTER_PACKAGES` (core) gains `@componode/importer-docker`.
- `packages/backend/package.json` and `packages/agent/package.json`
  gain the dependency (manifest import only).
- Agent `hello` importer list therefore matches the hub — the same
  lockstep rule as every other importer; the agent image must be
  rebuilt from the same commit.
