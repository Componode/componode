# Quickstart: validating spec 064 (Docker importer enrichment)

## Prerequisites

- `pnpm install` at repo root (workspace already set up).
- No live Docker Engine required — the importer test suite mocks
  `dockerode`; a real engine is only needed for manual UI verification.

## Automated validation

```bash
# Importer package — unit tests exercise validateDiscoveredAsset on every
# emitted shape (container fields, swarm fields, engine asset, images)
cd packages/importer-docker && pnpm test

# Frontend — docker-details renderers + component-detail integration
cd packages/frontend && pnpm test -- component-observation docker-details

# Full gates for changed packages
cd packages/importer-docker && pnpm lint && pnpm typecheck && pnpm build
cd packages/frontend && pnpm lint && pnpm typecheck && pnpm build
pnpm build   # root — workspace integrity
```

Expected: all green; `docs:api:check`/contract tests unaffected (no API
change); `docs:importers:check` unaffected (no manifest/config change —
verify anyway via root `pnpm docs:check`-style scripts if present).

## What the tests must prove (spec → test mapping)

| Spec requirement | Test location |
|---|---|
| FR-001..005 container `imageId`/`hostConfig`/`healthcheck`, no Env/Test | `importer-docker/test/mapping.test.ts`, `importer.test.ts` |
| FR-006..008 swarm ports/networks/job-mode | `importer-docker/test/swarm.test.ts` |
| FR-009..013 engine component, exclusions, identity | `importer-docker/test/engine.test.ts` (new), `importer.test.ts` |
| FR-014..017 image inspect dedupe + degrade-per-image | `importer.test.ts` (new `getImage` mock) |
| FR-018..020 allowlisted UI sections, no rawConfig dump | `frontend/src/test/unit/` |
| SC-004 exclusions | negative assertions in mapping/swarm/importer tests |

## Manual smoke (optional, needs a Docker Engine)

1. Run a Hub- or Agent-bound Docker import against any engine.
2. Open the engine's component (`docker-engine` resourceType) → Details
   card shows Engine section.
3. Open a container component → expand an instance row → Host config +
   Health check sections alongside Observation.
4. With `includeImages` on → open an image component → Image provenance
   section shows allowlisted OCI labels only.
5. `docker inspect` the same container and diff: no env vars, no health
   test command, no host bind paths anywhere in the UI.
