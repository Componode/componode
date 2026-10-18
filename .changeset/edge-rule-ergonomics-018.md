---
"@componode/backend": minor
"@componode/frontend": minor
---

Edge-rule ergonomics (spec `018-edge-rule-ergonomics`, ADR-109):

- Any `DigitalProduct` type may now be a `COMPOSES` parent — the
  `COMPOSES_PARENT_TYPE` rejection is removed. `COMPOSES` is a general DAG
  guarded only by self-edge rejection (`422 INVALID_EDGE_TYPE`) and cycle
  detection (`409 CYCLE_DETECTED`), both unchanged.
- Retyping a product to `PLATFORM` is no longer blocked by its `COMPOSES`
  children; retyping a `CONSUMES_FROM` target away from `PLATFORM` is still
  blocked (`409 TYPE_CHANGE_BLOCKED`).
- The "Composes" edge picker is enabled for every product type — the
  "only Business Capability and Customer-Facing" gate is gone.
