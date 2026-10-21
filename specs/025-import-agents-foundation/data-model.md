# Data Model — Import Agents Foundation

## New tables (migration `016_import_agents.ts`)

### `import_agents`

| Column                     | Type          | Constraints                                  | Notes                                                                                                                     |
| -------------------------- | ------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `id`                       | `uuid`        | PK                                           | UUID v7 generated app-side, passed as SQL parameter (ADR-045)                                                             |
| `name`                     | `text`        | `NOT NULL UNIQUE`                            | `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`, 1–63 chars (spec clarification); no slug — ImportAgent is not in the ADR-046 slug list |
| `status`                   | `text`        | `NOT NULL DEFAULT 'NEVER_CONNECTED'` + CHECK | `AGENT_STATUSES` from core                                                                                                |
| `agentVersion`             | `text`        | nullable                                     | reported in `hello`; null until first connect                                                                             |
| `protocolVersion`          | `integer`     | nullable                                     | reported in `hello`                                                                                                       |
| `importerVersions`         | `jsonb`       | `NOT NULL DEFAULT '[]'`                      | `[{name, version}]` from `hello`                                                                                          |
| `allowedImporters`         | `jsonb`       | `NOT NULL DEFAULT '[]'`                      | hub policy; empty = all importers (ADR-116 #13)                                                                           |
| `maxConcurrentJobs`        | `integer`     | nullable                                     | advertised capacity from `hello`; informational in this spec                                                              |
| `credentialHash`           | `text`        | nullable                                     | SHA-256 of durable credential (`hashToken`); null until enrolled                                                          |
| `credentialIssuedAt`       | `timestamptz` | nullable                                     | when the durable credential was issued                                                                                    |
| `enrollmentTokenHash`      | `text`        | nullable                                     | SHA-256 of the current enrollment token; replaced on rotate                                                               |
| `enrollmentTokenExpiresAt` | `timestamptz` | nullable                                     | ~24 h TTL from issuance                                                                                                   |
| `enrollmentTokenUsedAt`    | `timestamptz` | nullable                                     | set at exchange → single-use                                                                                              |
| `revokedAt`                | `timestamptz` | nullable                                     | credential revocation; separate axis from `status` (R10)                                                                  |
| `lastSeenAt`               | `timestamptz` | nullable                                     | last accepted frame on any session                                                                                        |
| `createdBy` / `updatedBy`  | `uuid`        | FK → `persons.id`                            | admin actor                                                                                                               |
| `createdAt` / `updatedAt`  | `timestamptz` | `NOT NULL DEFAULT now()`                     |                                                                                                                           |

Indexes: `import_agents_status_idx (status)`; unique index on `name`
(via UNIQUE constraint). Token/credential hashes are looked up through
the agent record (enrollment resolves token → agent via
`enrollmentTokenHash` index lookup) — add
`import_agents_enrollment_hash_idx (enrollmentTokenHash)` partial index
is unnecessary; the table is small, a plain index suffices — actually
add `import_agents_credential_hash_idx (credentialHash)` and
`import_agents_enrollment_hash_idx (enrollmentTokenHash)` since both are
auth-path lookups.

### `agent_sessions` _(operational data — NOT trigger-protected, ADR-116 amends ADR-100)_

| Column             | Type          | Constraints                                            | Notes                                               |
| ------------------ | ------------- | ------------------------------------------------------ | --------------------------------------------------- |
| `id`               | `uuid`        | PK                                                     | UUID v7                                             |
| `agentId`          | `uuid`        | `NOT NULL` FK → `import_agents.id` `ON DELETE CASCADE` | sessions die with the agent record                  |
| `connectedAt`      | `timestamptz` | `NOT NULL DEFAULT now()`                               |                                                     |
| `disconnectedAt`   | `timestamptz` | nullable                                               | null while live                                     |
| `disconnectReason` | `text`        | nullable + CHECK                                       | `AGENT_DISCONNECT_REASONS`; null until closed       |
| `remoteAddress`    | `text`        | nullable                                               | peer IP from the upgrade request (trustProxy-aware) |
| `agentVersion`     | `text`        | nullable                                               | from `hello`                                        |
| `protocolVersion`  | `integer`     | nullable                                               | from `hello`                                        |
| `importerVersions` | `jsonb`       | `NOT NULL DEFAULT '[]'`                                | from `hello`                                        |

Indexes: `agent_sessions_agent_idx (agentId, connectedAt DESC)`;
`agent_sessions_open_idx (agentId) WHERE disconnectedAt IS NULL`
(partial — fast "is there a live session" check).

### `importer_configs.agentId`

`ALTER TABLE importer_configs ADD COLUMN agentId uuid NULL
REFERENCES import_agents(id) ON DELETE RESTRICT` — delete-block for
FR-005 enforced at the DB layer; the column cannot be set until spec 027
(research R7). Index `importer_configs_agent_idx (agentId)` partial
(`WHERE agentId IS NOT NULL`) is optional; table is small — include the
plain index for the delete-check query pattern.

## Core constants (`packages/core/src/constants/import-agent.ts`)

```ts
AGENT_STATUSES = ["NEVER_CONNECTED", "CONNECTED", "OFFLINE"];
AGENT_DISCONNECT_REASONS = [
  "client_close",
  "heartbeat_timeout",
  "revoked",
  "shutdown",
  "superseded",
  "replaced",
];
AGENT_AUDIT_ACTIONS = [
  "created",
  "enrolled",
  "token_rotated",
  "updated",
  "revoked",
  "deleted",
];
AGENT_PROTOCOL_VERSION = 1;
AGENT_HEARTBEAT_INTERVAL_MS = 30_000; // agent → hub
AGENT_STALE_AFTER_MS = 90_000; // hub marks offline
AGENT_SESSION_SWEEP_MS = 15_000; // hub sweep interval
AGENT_ENROLLMENT_TTL_MS = 86_400_000; // 24 h
```

## New error codes (`packages/core/src/constants/error-codes.ts`)

`AGENT_NOT_FOUND` (404) · `AGENT_NAME_TAKEN` (409) ·
`AGENT_IN_USE` (409 — delete blocked, mirrors `CREDENTIAL_IN_USE`) ·
`AGENT_ENROLLMENT_INVALID` (401 — unknown/expired/used token) ·
`AGENT_CREDENTIAL_INVALID` (401 — bad/revoked credential on upgrade) ·
`AGENT_VERSION_MISMATCH` (403 — handshake reject).

Deferred to 026/027 (ADR-116): `AGENT_LOST`, `AGENT_UNAVAILABLE`,
`AGENT_OFFLINE`, `AGENT_INCOMPATIBLE`, `ASSET_TOO_LARGE` (R12).

## Core contracts (`packages/core/src/contracts/import-agent.ts`)

- `ImportAgent` DTO — id, name, status, agentVersion, protocolVersion,
  importerVersions, allowedImporters, maxConcurrentJobs, lastSeenAt,
  revokedAt, hasCredential (bool — never the hash), pendingEnrollment
  (bool: unused + unexpired token exists), createdAt/updatedAt.
  **Never serializes** `credentialHash`/`enrollmentTokenHash`.
- `AgentSession` DTO — id, agentId, connectedAt, disconnectedAt,
  disconnectReason, remoteAddress, versions.
- `createImportAgentSchema` — `{ name: string.min(1).max(63).regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/),
allowedImporters?: string[] }` (strict); `allowedImporters` entries are
  validated against the known importer manifest names — unknown →
  `VALIDATION_FAILED` (spec clarification).
- `updateImportAgentSchema` — `{ name?, allowedImporters? }` (strict);
  same manifest-name validation.
- `enrollRequestSchema` — `{ token: string }` (strict).

## Token lifecycle state machine

```text
create ──► [enrollmentToken issued, usedAt=null, expiresAt=+24h]
                │ expire                       │ POST /agent/enroll
                ▼                              ▼
          token dead (unusable)        credentialHash set,
                                       enrollmentToken* cleared,
                                       status unchanged
rotate ──► new enrollmentToken* supersedes any prior (single slot);
           clears revokedAt; OLD credentialHash stays valid (graceful
           overlap) until the next successful enroll exchange
revoke ──► revokedAt=now, credentialHash kept-but-dead, session dropped
enroll exchange on rotated agent ──► credentialHash replaced (old dies),
           live session (if any) dropped `replaced`, `enrolled` audit
```

Invariants: at most one live enrollment token per agent; a used/expired
token never reactivates; rotation clears `revokedAt` (re-enablement path)
while the old credential survives until superseded at exchange —
"previous credential stops working once superseded" (FR-004).

## Audit mapping (`entity_changes`, `entityType: "import_agent"`)

| Event                                | action          | actor                    |
| ------------------------------------ | --------------- | ------------------------ |
| Agent created                        | `created`       | admin                    |
| Successful enrollment                | `enrolled`      | `agent:<name>` (id null) |
| New enrollment token issued (rotate) | `token_rotated` | admin                    |
| Policy/name update (`PATCH`)         | `updated`       | admin                    |
| Revoked                              | `revoked`       | admin                    |
| Deleted                              | `deleted`       | admin                    |

Rejected upgrades / failed enrollments: Pino warn +
`agent_stream_rejected_total{reason}` — **no audit rows** (ADR-116 #12).
