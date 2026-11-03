# Contract: Component Relationships read

## Route

Add an authenticated, side-effect-free read:

```text
GET /api/v1/components/{componentId}/relationships
```

Query:

| Parameter     | Default | Meaning                                                        |
| ------------- | ------: | -------------------------------------------------------------- |
| `includeGone` | `false` | Include `GONE` ComponentInstances in the nested instance group |

The route returns the focused Component's one-hop typed relations:

```text
{
  component,
  relationships: {
    dependsOn,
    dependedOnBy,
    sourcesFrom,
    sourcedBy,
    exposes,
    exposedBy,
    productDependents: { direct, viaGroups },
    instances
  },
  unavailableKinds: []
}
```

Each Component/Product/ComponentGroup reference carries a stable ID, display
name, slug, and the type/lifecycle fields needed for accessible labeling.
Product paths via groups include `viaGroup` identity and name. Instance
references include environment and current operational status. `unavailableKinds`
identifies relation groups that could not be read; the response never silently
drops an unavailable group.

## Read behavior

- Reads require an authenticated session and do not mutate domain/audit state.
- A missing focused Component returns the existing safe `NOT_FOUND` envelope.
- Related Component targets follow the existing Component detail read
  visibility policy and include lifecycle when returned.
- ComponentInstances follow the current Component detail read default, which
  excludes `GONE`; the feature does not introduce a new include-GONE query.
- Product direct dependents and ComponentGroup-mediated paths are distinct.
- Queries are bounded; the frontend receives all groups in one read rather
  than fetching one relation per node.
- No create/update/delete operation is added for Component relationship edges.

## Documentation and contract enforcement

Add the operation and schemas to `docs/openapi.yaml`, including session
security, error responses, and permission metadata; regenerate `docs/api.md`.
The backend route-coverage contract test must verify the route and
`verifySession` behavior under ADR-104.
