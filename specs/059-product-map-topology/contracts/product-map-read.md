# Contract: Product Map read data

## Read seam

Use the authenticated `GET /api/v1/products/{slug}` detail read. No new route
or write operation is added. The existing response already contains:

- `composedBy`
- `composes`
- `consumesFrom`
- `consumedBy`
- `dependsOnGroups`
- `components` and related Product health for the focused Product

## Additive related Product fields

Each related `ProductRef` used by the topology gains:

| Field            | Type                                        | Meaning                                                                       |
| ---------------- | ------------------------------------------- | ----------------------------------------------------------------------------- |
| `criticality`    | `CRITICAL \| HIGH \| MEDIUM \| LOW \| null` | Human triage hint                                                             |
| `health`         | `ProductHealth \| null`                     | ADR-112 derived health; null means no contributing health sources             |
| `componentCount` | integer ≥ 0                                 | Component count using the detail read's existing declared/inherited semantics |

The detail handler enriches all related ProductRefs in a bounded batch. The
response preserves every relation array and its direction. ComponentGroup
nodes use their existing `id`, `name`, `slug`, and `memberCount`.

If a relation-family read fails while the other relation families are
available, the response includes `unavailableRelationGroups`, an array of
relation-family keys such as `composedBy` or `dependsOnGroups`. That family's
array is empty, and the UI renders an explicit partial-state warning rather
than treating the family as an empty relationship set. Failure of the focused
Product read itself remains a normal error response.

## Error and state behavior

- Authentication and 404 behavior remain unchanged.
- Loading, error, and forbidden states use the existing page-state patterns.
- If a relation family is unavailable in the read result, the UI renders an
  explicit partial-state warning naming that family; it never hides it.
- The read is side-effect-free and does not author or mutate an edge.

## Documentation

Update `docs/openapi.yaml` for additive response fields and regenerate
`docs/api.md` under ADR-104. The route path, method, and read permission do
not change.
