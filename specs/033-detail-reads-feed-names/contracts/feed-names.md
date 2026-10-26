# Contract: feed display names on audit items

Applies to `GET /api/v1/audit/activity`, `GET
/api/v1/audit/entities/:entityType/:entityId`, and `GET
/api/v1/importer-configs/:id/runs/:runId/changes`. Names are resolved
server-side at read time — historical rows are covered and renames show
the current name.

## Shape delta

```jsonc
// entity-kind item (EntityChange)
{ "kind": "entity", "entityType": "component", "entityId": "0194…",
  "entityName": "payments-db", /* NEW: string | null */ … }

// edge-kind item (EdgeChange)
{ "kind": "edge", "edgeType": "DEPENDS_ON_COMPONENT",
  "fromEntityType": "digital_product", "fromEntityId": "0194…",
  "fromEntityName": "Payments App",                    /* NEW: string | null */
  "toEntityType": "component", "toEntityId": "0194…",
  "toEntityName": "payments-db",                       /* NEW: string | null */
  … }
```

`null` = name not resolvable: deleted entity, null `entityId`, or a
non-entity type (`session`, `settings`, `auth`, `correction`, unknown).
Clients render their defined fallback — never a synthesized `type:id`
string from the server.

## Name sources

| entityType | Source |
|---|---|
| `digital_product` | `digital_products.name` |
| `component` | `components.name` |
| `component_instance` | `components.name` via `componentId` + `environment` (`"name · env"`) |
| `component_group` | `component_groups.name` |
| `importer_config` | `importer_configs.label` |
| `credential` | `credentials.label` |
| `user` | `persons."displayName" ?? username` |
| `team` | `teams.name` |
| `line_of_business` | `line_of_businesses.name` |
| `import_agent` | `import_agents.name` |
| `session`, `settings`, `auth`, `correction`, other | `null` |

Resolution is per response page — `limit ≤ 200` bounds the id sets; each
touched entity type costs one `where id in (…)` lookup.
