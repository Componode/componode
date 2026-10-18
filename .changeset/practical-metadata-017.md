---
"@componode/backend": minor
"@componode/core": minor
"@componode/frontend": minor
---

Practical catalog metadata (spec `017-product-metadata`, ADR-111):

- Digital products and components gain optional curated `links` (titled http/https references, ≤20, order-preserving), `tags` (normalized lowercase, ≤20, `[a-z0-9][a-z0-9._:-]{0,31}`), and `sunsetAt` (display-only date); products additionally gain `criticality` (`CRITICAL`/`HIGH`/`MEDIUM`/`LOW`).
- `GET /products` supports `?tag=` and `?criticality=` filters; `GET /components` supports `?tag=` — all exact-match on normalized values.
- `PATCH /components/:id` generalizes to a curated update (metadata plus group/owner assignment); component detail pages get an edit surface.
- Detail pages render links cards (safeUrl-validated), tag chips, criticality badges, and a three-state sunset badge (`Sunset in {n}d` amber ≤30d, `Sunset overdue` red, suppressed when RETIRED); list pages gain tag/criticality filters and badges.
- Metadata changes write `entity_changes` audit rows; importer reconciliation never touches curated fields (FR-015).
