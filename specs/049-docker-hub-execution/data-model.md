# Data Model: Docker Hub execution and managed targets

## `docker_targets` (new)

| Column | Type | Rules |
|---|---|---|
| `id` | `uuid` | PK, UUIDv7 supplied by the service |
| `targetId` | `text` | unique, immutable, trimmed length 1–200; selector stored in Docker config `scope.targetId` |
| `label` | `text` | required, mutable, max 100 |
| `description` | `text` | nullable, mutable, max 1000 |
| `profile` | `jsonb` | required, validated against Docker’s manifest `targetProfileSchema`; stores no secret values |
| `enabled` | `boolean` | required, default `true` |
| `createdBy`/`updatedBy` | `uuid` | nullable FK to `persons`, `ON DELETE SET NULL` |
| `createdAt`/`updatedAt` | `timestamptz` | required |

Indexes: unique `targetId`; `enabled` for picker/save validation.

No foreign key is added to `importer_configs.scope.targetId`; scope remains JSONB. Referenced-target deletion is enforced by the service by scanning Docker configs whose `agentId IS NULL` and `scope->>'targetId'` equals the selector.

## `import_runs` (amended)

| Column | Type | Rules |
|---|---|---|
| `cancelReason` | `text` | nullable; CHECK `cancelReason IN ('USER_REQUESTED','TARGET_DISABLED')`; set only when `cancelRequestedAt` is stamped |

Terminal-state immutability remains unchanged. The reason is stamped while the run is active; recovery finalizes `CANCELLED` without clearing it.

## API entities

### `DockerTarget`

```json
{
  "id": "uuid",
  "targetId": "prod-docker-1",
  "label": "Production Docker",
  "description": "Swarm manager",
  "profile": { "transport": "tcp", "host": "docker.internal", "clientCertKey": "clientCert", "clientKeyKey": "clientKey" },
  "enabled": true,
  "createdAt": "iso-time",
  "updatedAt": "iso-time"
}
```

Profiles never contain certificate/key values. `*Key` fields name keys supplied by linked credentials.

### `ImportRun`

Adds optional `cancelReason: "USER_REQUESTED" | "TARGET_DISABLED" | null`.

## Lifecycle rules

- `enabled=false` blocks new assignment, run, test, and selection.
- Existing configs may retain a disabled selector and can be edited in unrelated fields.
- Re-enable restores prior references.
- Delete is blocked while any Docker config references the selector.
- Multiple configs may use one target; each config still resolves one Docker Engine Source.
