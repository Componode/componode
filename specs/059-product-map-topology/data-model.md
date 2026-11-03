# Data Model: Product Map topology in Dependencies

## Scope

The feature is a read-only projection of existing Product and ComponentGroup
relationships. It adds no persisted entity, edge type, or authoring action.

## Nodes

| Node                   | Source                                                 | Display data                                                            |
| ---------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------- |
| Focused DigitalProduct | Existing `product` detail row                          | Name, type, criticality, current health, Component count, link          |
| Related DigitalProduct | `composedBy`, `composes`, `consumesFrom`, `consumedBy` | Name, slug, type, lifecycle, criticality, health, Component count, link |
| ComponentGroup         | `dependsOnGroups`                                      | Name, slug, member count, link                                          |

Individual Components are not graph nodes. Their declared/inherited dependency
rows remain in the existing Components list on the Components tab. Component
membership count on a Product remains a summary field, not a node expansion.

Product health is derived under ADR-112; it is never stored on a Product
relation edge. A related Product with no health sources has `health: null`.

## Directed relations

| Relation                         | Source → target                             | Lane when focused on Product |
| -------------------------------- | ------------------------------------------- | ---------------------------- |
| `COMPOSES` (`composedBy`)        | Parent Product → focused Product            | Incoming Product             |
| `COMPOSES` (`composes`)          | Focused Product → child Product             | Outgoing Product             |
| `CONSUMES_FROM` (`consumesFrom`) | Focused Product → Platform Product          | Dependency Product           |
| `CONSUMES_FROM` (`consumedBy`)   | Consumer Product → focused Platform Product | Consumer Product             |
| `DEPENDS_ON` (`dependsOnGroups`) | Focused Product → ComponentGroup            | Dependency group             |

Physical lane position never changes the source/target direction. Edge labels
and accessible node descriptions identify the relation semantics where the
same Product appears through multiple relation kinds.

## Read response extension

The existing Product detail response remains the source for the topology. Its
related Product references gain:

- `criticality: CRITICAL | HIGH | MEDIUM | LOW | null`;
- `health: ProductHealth | null`, with ADR-112 status and per-environment
  breakdown; and
- `componentCount`, matching the Product detail's declared/inherited
  Component count semantics.

All related refs are enriched in one bounded backend read. No N+1 detail or
health request is issued from the canvas.

## View state

- `focusProductId` is determined by the detail route, not a second graph
  selector.
- Focus/selection, inspected node, and expanded-lane state are view-only and
  reset on Product navigation.
- Each relation lane initially shows up to four nodes; `+N` expands only that
  lane.
- Health display uses existing Product-health status metadata and preserves
  null as no data.
- Loading, empty, error, forbidden, partial, and reduced-motion states do not
  alter or infer catalog relationships.
- A relation family that cannot be read is listed in
  `unavailableRelationGroups`; its empty array is not rendered as a confirmed
  no-relations state.

## Invariants

- Every returned Product relation group is rendered in the topology or in an
  explicit typed summary.
- `COMPOSES` and `CONSUMES_FROM` arrow direction is derived from persisted
  source/target fields, not lane position.
- ComponentGroup dependency edges remain visible even when the group has no
  members.
- Product health is derived from that Product's own direct Component
  dependencies under ADR-112; it is not inferred from a related Product's
  health or a URL Check's raw observation.
- Topology interactions do not write catalog state.
