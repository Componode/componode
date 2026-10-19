---
"@componode/core": minor
"@componode/backend": minor
"@componode/frontend": minor
---

Staged edge suggestions (spec `022-edge-suggestions`, ADR-113): the server generates `DEPENDS_ON` candidates from stored catalog data and humans decide each one — the meaning layer no longer starts completely manual.

- `GET /suggestions` lists the review queue (`PENDING`, score-desc, `RETIRED` endpoints excluded) or the permanent `DISMISSED` history; `POST /suggestions/{id}/accept` wires the real edge through the standard edge path (same audit trail) and marks the row `ACCEPTED`; `POST /suggestions/{id}/dismiss` marks it `DISMISSED` irreversibly. Reads need any authenticated role; decisions need `product:edge:add`.
- Candidates are scored on three signals — name-token containment (`NAME_MATCH`), tag/topic overlap (`TOPIC_TAG_MATCH`), and Kubernetes namespace overlap (`NAMESPACE_MATCH`) — above a 0.5 floor, staged as one row per `(product, component)` pair.
- Pairs covered by a real or `ComponentGroup` edge become `SUPERSEDED` tombstones; decided pairs never resurface and deleted edges never regenerate. Generation runs after successful import runs, on product/component signal-affecting writes, and on demand via `POST /suggestions/rescan`.
- New `/suggestions` page (Catalog nav): score-sorted pending queue with reason chips and per-row accept/dismiss for `EDITOR+`, plus a dismissed-history filter showing the decider and time.
