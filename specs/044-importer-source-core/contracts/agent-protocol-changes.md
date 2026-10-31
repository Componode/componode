# Contract — Agent protocol and target-registry changes

Lives in `packages/core/src/contracts/agent-protocol.ts` +
`packages/core/src/constants/import-agent.ts`. Enumerated surfaces →
ratified by ADR-116 Amendment 6 and ADR-056 Amendment 2 (see research.md).

## Protocol version

`AGENT_PROTOCOL_VERSION: 2 → 3`. Hello parity is exact-match, so this is
the honest lockstep signal.

## New frame — `source.identity` (agent → hub, job stream)

```ts
sourceIdentity: jobEnvelope.extend({
  type: z.literal("source.identity"),
  payload: z.object({
    externalIdentity: z.string().min(1).max(512),
    label: z.string().max(200).optional(),
  }).strict(),
})
```

- Sent by the agent-side `context.reportSourceIdentity` implementation;
  required before the first `asset.batch` for jobs whose manifest declares
  `reportsSourceIdentity` (agent enforces ordering — a yield before
  identity fails the job `CONTRACT_VIOLATION`).
- Hub `onSourceIdentity`: register-or-match `(importerName,
  externalIdentity)`, bind `boundConfigId`, stamp `import_runs.sourceId`,
  set `status=ACTIVE` (reactivation on return). In-process
  `reportSourceIdentity` performs the same DB work directly.
- `JOB_STREAM_TYPES` gains `"source.identity"`; `agentMessageSchemas`
  gains the schema; `RemoteRunHandler` gains `onSourceIdentity`;
  `docs/agent-protocol.md` documents it.

## New NACK prefix — target preflight

`AGENT_NACK_TARGET_RESOLUTION_PREFIX = "TARGET_RESOLUTION_FAILED"` in
`constants/import-agent.ts`. Agent `job.ack{accepted:false,
reason:"TARGET_RESOLUTION_FAILED: <non-secret>"}` on:

- manifest declares `targetRefKey` but `scope[targetRefKey]` is missing or
  not a non-empty string;
- registry file absent/unparseable/wrong `version` (empty allowlist — fail
  closed);
- `targetId` not present in `targets`, or profile not a well-formed object.

Hub `onJobAck` gains a mapping branch → run `FAILED` with
`errorType=TARGET_RESOLUTION_FAILED` (does not fall through to
`AGENT_INCOMPATIBLE`). The hub `jobGate` mirrors the scope-shape check
fail-fast before enqueue (same errorType).

## Target registry — agent-local file

`${SECRETS_DIR}/{importerName}-targets.json`, loaded fresh per
`job.assign` for manifests declaring `targetRefKey`:

```json
{
  "version": 1,
  "targets": {
    "prod-daemon-01": { "transport": "tcp", "host": "…", "port": 2376 }
  }
}
```

- Envelope validated agent-side (Zod schema in core, node-only export
  path): `version === 1`, `targets` a record of objects.
- The registry IS the allowlist — absent `targetId` = rejected.
- `targetId`s immutable — endpoint/transport/pinning changes = new ID.
- Transport-specific profile fields are validated by the importing
  importer at use time (Docker's typed profiles land in Wave C).
- `context.resolveTarget(targetId)` returns the resolved profile on the
  agent; the in-process context provides a stub that throws
  (`targetRefKey` manifests are agent-bound by definition).
