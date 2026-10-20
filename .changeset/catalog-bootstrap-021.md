---
"@componode/core": minor
"@componode/backend": minor
"@componode/frontend": minor
---

Catalog bootstrap (spec `021-catalog-bootstrap`, ADR-114): the meaning layer no longer starts at zero — import an existing application inventory declaratively.

- `POST /products/bootstrap` accepts a YAML or JSON document declaring products (name, type, description, owner slugs, tags, criticality, `sunsetAt`) plus `dependsOn` component refs resolved by slug → name → `externalId`. Strict whole-document validation first, then best-effort apply: products upsert by derived slug, unresolved refs land in the `{created, updated, edgesAdded, skipped}` report — never fabricated, never fatal. No `COMPOSES`/`CONSUMES_FROM` in the file, no implicit entity creation.
- `?dryRun=true` returns the identical report with zero writes; re-importing an unchanged file reports all zeros and writes no audit rows.
- Components list → **Create product** wires a new product to every checked `ACTIVE` component in one transaction; the dependency picker now accepts a checked set via `componentIds[]` (or a single `componentGroupId` — never both).
