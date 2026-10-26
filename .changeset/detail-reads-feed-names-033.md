---
"@componode/core": minor
"@componode/backend": minor
"@componode/frontend": minor
---

Detail reads and audit feed names (spec `033-detail-reads-feed-names`, gaps G7/G8/G9/G11): `GET /teams/:id` and `GET /lobs/:id`; team/LOB/component-group detail reads resolve id-or-slug; audit feed, entity history, and run changes carry server-resolved `entityName`/`fromEntityName`/`toEntityName`.
