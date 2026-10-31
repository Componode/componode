# Contract — ImporterSource API

All routes under `/api/v1` (ADR-070); error envelope `{code,message,details?}`
(ADR-071); Zod `.strict()` schemas in `packages/core/src/schemas/`;
`docs/openapi.yaml` updated in the same change (ADR-104).

## `GET /importer-sources` — `verifySession`

Query (all optional): `status` (enum), `importerName` (string).

```json
{ "sources": [ {
  "id": "uuid", "importerName": "docker", "externalIdentity": "engine:abc…",
  "label": "prod docker-01", "status": "ACTIVE",
  "boundConfig": { "id": "uuid", "label": "Docker prod" } | null,
  "lastCompletedRunAt": "iso" | null,
  "activeComponentMemberships": 12, "activeInstanceMemberships": 30,
  "createdAt": "iso", "updatedAt": "iso"
} ] }
```

## `GET /importer-sources/:id` — `verifySession`

`{ "source": { …same fields… } }` — `404 SOURCE_NOT_FOUND`.

## `GET /importer-sources/:id/runs` — `verifySession`

`{ "runs": [ ImportRun ] }` — full history incl. `configId: null` orphan
runs. `404 SOURCE_NOT_FOUND`.

## `POST /importer-sources/:id/retire` — `importer:source:retire` (ADMIN)

Body: `{}`. → `200 { "source": … }`. `404 SOURCE_NOT_FOUND`,
`409 SOURCE_STATE_CONFLICT` when already `RETIRED`.

Effect (one transaction): `status=RETIRED`, then the retire-side entity
evaluation — entities whose effective-active membership count drops to
zero retire per reconciliation rules (`Component RETIRED`, instances
`GONE`). Membership rows are preserved.

## `POST /importer-sources/:id/reactivate` — `importer:source:reactivate` (ADMIN)

Body: `{}`. → `200 { "source": … }`. `404 SOURCE_NOT_FOUND`,
`409 SOURCE_STATE_CONFLICT` when not `RETIRED`. Result: `ACTIVE` if bound,
else `UNMONITORED`.

## New error codes (core `ERROR_CODES` + `ERROR_TYPES` + openapi `Problem` + `CODE_MEANINGS`)

| Code | HTTP | Title |
|---|---|---|
| `SOURCE_NOT_FOUND` | 404 | Importer source not found |
| `SOURCE_STATE_CONFLICT` | 409 | Invalid source lifecycle transition |

## New permissions (`plugins/rbac.ts` `PERMISSIONS` — ADR-054 surface)

`"importer:source:retire": "ADMIN"`, `"importer:source:reactivate": "ADMIN"`.
Reads are authenticated-any (viewer-readable), consistent with
`GET /importer-configs`.

## Audit

`entityType: "importer_source"`; actions `created` (first registration),
`bound`, `unmonitored`, `retired`, `reactivated` — via `writeEntityChange`
inside the mutation transaction; `audit-query-service.namesFor` gains an
`"importer_source"` case so the feed renders the label.
