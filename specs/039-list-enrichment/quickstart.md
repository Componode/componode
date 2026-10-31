# Quickstart: List Enrichment validation

1. `GET /components` returns `worstStatus` + `lastSeenAt` per row; a
   zero-instance component returns both null.
2. Mixed-state component (RUNNING + ERROR) reports `worstStatus: "ERROR"`.
3. Components list (flags ON) renders Health badge + Last seen — no
   "No data"/"—" on rows with instances.
4. `GET /teams` returns `memberCount` + `componentCount` per row.
5. Teams list Members column shows real counts incl. `0`; LOB detail
   teams table shows `Team | Members | Components` fully populated.
6. `pnpm test` — backend list-endpoint integration tests assert the new
   fields and absence of N+1 (single query).
7. `docs/openapi.yaml` regenerated; `api-docs-contract` test stays green.
