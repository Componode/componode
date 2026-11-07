### ADR-029 — Testing: shared importer harness + integration tests

> **Status:** Ratified

**Context**: The testing strategy is part of the contributor contract.

**Decision**: **A+ + B.**
- **Importer packages**: unit tests against a shared harness that enforces the
  `DiscoveredAsset` contract (valid `category`/`provider`, stable `externalId`,
  required fields present). Contributors get a failing test for free if their
  importer yields malformed assets.
- **`packages/backend`**: integration tests (testcontainers Postgres) for the
  core upsert/dedup/edge-rewrite/hierarchy path.
- **E2e**: deferred to post-v1.

**Rationale**: The shared harness is what makes the importer contract
enforceable — a contributor runs `pnpm test` and the harness tells them their
`DiscoveredAsset` records are malformed without a maintainer reviewing for
that. Integration tests for the core path (the maintainers' responsibility)
catch schema/query bugs.

## Amendment 1 — Per-spec Playwright coverage

The "E2e: deferred to post-v1" deferral has ended. The `playwright/`
workload (spec 055) is the standing e2e mechanism, and every spec —
feature or bugfix — now ships Playwright coverage for the surface it
changed (browsing flows, CRUD, integrations, data integrity as
applicable). See `AGENTS.md` § Testing and constitution VI.