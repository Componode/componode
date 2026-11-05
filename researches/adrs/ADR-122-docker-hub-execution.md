# ADR-122 — Docker importer: Hub execution and managed targets

**Status**: Ratified (2026-11-01, spec 049)
**Supersedes**: none
**Amends**: ADR-056, ADR-058, ADR-052, ADR-054, ADR-071, ADR-077, ADR-116, ADR-119, ADR-121 (see "Amendments to earlier ADRs")

## Context

ADR-121 made Docker the first — and only — `requiresAgent` importer: some
environments are not ready for Agents or simply do not need one. Running
the Docker importer in-process was blocked by three things: the manifest
flag, a Hub `resolveTarget` stub that always threw, and no place for the
Hub to keep trusted, non-secret Docker access routes (the Agent's
`docker-targets.json` registry is Agent-local by ADR-116 A5).

## Decision

1. **Dual-executor Docker importer.** `requiresAgent` is removed from the
   Docker manifest. `agentId: null` executes in the Hub worker; a non-null
   `agentId` executes on the Agent through the unchanged outbound WSS
   protocol. Inventory parity is complete — containers, opt-in images,
   health observations, and Swarm surfaces are identical on both
   executors. Source identity stays `docker-engine:{/info.ID}` (or the
   `sourceKey` fallback): the Source does not change when the executor
   changes.

2. **`docker_targets` — Hub-managed target registry.** A new table is the
   Hub's allowlist, mirroring the Agent's file registry:
   - `id uuid` PK (UUIDv7, ADR-045).
   - `targetId text UNIQUE` — immutable selector, 1–200 chars, stored in
     Docker config `scope.targetId`. The same selector text on Hub and on
     an Agent is *not* guaranteed to reach the same Engine — executors
     own their registries.
   - `label`/`description` — mutable display metadata only.
   - `profile jsonb` — strict, transport-discriminated Docker profile
     (the ADR-121 item-4 schema: socket/tcp/ssh/context, unchanged).
     Profiles carry no secret values; `*Key` fields name credential keys
     and are immutable like every route field.
   - `enabled boolean` — disable blocks new selection, tests, and runs;
     existing configs keep the reference and may be edited in unrelated
     fields but cannot run until re-enabled or retargeted.
   - `createdBy`/`updatedBy`, `createdAt`/`updatedAt`.
   Delete is blocked (`409 TARGET_IN_USE`) while any config references
   the selector. Multiple configs may reuse one target; each config still
   resolves exactly one Docker Engine.

3. **`ImporterManifest.targetProfileSchema`** — optional executor-local
   profile validator. Executors use it to preflight a profile; it is
   never serialized to clients. Docker declares its existing
   discriminated union. This keeps provider profile semantics in the
   importer package while letting the Hub validate DB-stored profiles
   without a duplicate schema.

4. **API** — `/api/v1/docker-targets`: `GET/POST` collection,
   `GET/PATCH/DELETE` member, `POST …/enable`, `POST …/disable`,
   `POST …/test`. All ADMIN-only via new permissions
   `importer:target:read|create|update|delete|test`. PATCH accepts only
   `label`/`description`. `test` probes Docker `/version` only (never
   inventory), using an explicitly selected Hub-bound Docker config's
   `STORED` credentials when the profile references `*Key` names.

5. **New controlled errors** — `TARGET_NOT_FOUND` (404),
   `TARGET_DISABLED` (409: assigning a disabled target to a config),
   `TARGET_IN_USE` (409: delete while referenced). Duplicate `targetId`
   reuses `CONFLICT`. Run/test channels reuse `TARGET_RESOLUTION_FAILED`
   and record `errorType: TARGET_DISABLED` for runs that find their
   target disabled at dispatch.

6. **Credential composition** — Hub Docker configs resolve `*Key` names
   from linked `STORED` credentials; Agent configs keep `AGENT_MANAGED`
   refs. Save-time validation on Hub Docker configs checks active-target
   existence *and* `*Key` coverage (`CREDENTIAL_MISSING_KEY`). Socket and
   Context profiles need no credential. No conversion between kinds.

7. **Executor switching** — changing a config between Hub and Agent
   clears `targetId` and credential selections; registries are
   executor-local. New Docker configs default to Hub; existing
   Agent-bound configs are never migrated.

8. **`import_runs.cancelReason`** — nullable text CHECKed to
   `USER_REQUESTED` | `TARGET_DISABLED`. Manual cancel stamps
   `USER_REQUESTED`; disabling a target requests cancellation of active
   Hub runs/tests with `TARGET_DISABLED` and returns after the request,
   not after Docker calls drain. The reason is exposed on run payloads
   and rendered as neutral cancellation text — `errorMessage` stays for
   real failures. Restart recovery keeps the stamped reason. The Agent
   cancel frame is unchanged: the Hub records the reason when it sends
   the existing frame.

9. **Audit** — `docker_target` entity type gains actions `created`,
   `updated`, `enabled`, `disabled`, `deleted`, `tested` (ADR-052).
   Entries may retain the non-secret route snapshot (transport +
   endpoint/socket/context descriptor and `*Key` names) — never cert or
   key material. Events appear in the Activity feed with the target
   label.

10. **Deployment** — the default Compose stack does **not** mount the
    host Docker socket. Socket and Context transports on Hub require
    explicit operator opt-in (socket bind-mount / Docker context store).
    Agent-local `docker-targets.json` is unchanged.

## Amendments to earlier ADRs

- **ADR-056** — `resolveTarget` is no longer Agent-only; the Hub executor
  supplies the same preflight-resolved profile. `ImporterManifest` gains
  optional `targetProfileSchema`.
- **ADR-058** — `import_runs` gains `cancelReason`
  (`USER_REQUESTED`|`TARGET_DISABLED`); durability survives recovery.
- **ADR-052** — audit gains the `docker_target` entity type with
  create/update/enable/disable/delete/test actions.
- **ADR-054** — the permission matrix gains
  `importer:target:read|create|update|delete|test` → ADMIN.
- **ADR-071** — the error enum gains `TARGET_NOT_FOUND` (404),
  `TARGET_DISABLED` (409), `TARGET_IN_USE` (409).
- **ADR-077** — schema inventory gains `docker_targets` and
  `import_runs.cancelReason`.
- **ADR-116** — Agent-local target registries are unchanged; the Hub now
  owns a second, database-backed registry for its own executor. No
  protocol change.
- **ADR-119** — target profiles are no longer exclusively Agent-local:
  the Hub resolves `targetId` through its own registry. Source identity
  semantics are untouched.
- **ADR-121** — item 2's `requiresAgent` for Docker is lifted by item 1
  here; items 4–6 (profile schema, scope keys, identities) apply on both
  executors.

## Amendment 1 — Stateless target probe (spec 063)

The guided Docker setup wizard needs to verify a prospective route
**before** any `docker_targets`/`credentials`/`importer_configs` rows
exist — the persisted `POST /docker-targets/:id/test` cannot serve that
(credential-requiring profiles demand a linked config). The API therefore
gains `POST /api/v1/docker-targets/probe` (permission
`importer:target:test`): request `{profile, secrets? | credentialId?}`
→ `{ok, error?}`. It validates the profile via the manifest's
`targetProfileSchema`, resolves secret material inline or from a STORED
credential (coverage-checked against the profile's `*Key` names), runs
the importer's existing `/version`-only `testSecrets` probe, and returns
a sanitized result. It persists nothing and writes no audit event —
probe attempts are ephemeral by design. Items 1–10 above are unchanged;
the governed target lifecycle, credential contracts, and executor split
are untouched.
