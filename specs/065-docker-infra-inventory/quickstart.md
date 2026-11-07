# Quickstart: validating spec 065 (Docker infrastructure inventory)

## Prerequisites

- `pnpm install` at repo root (workspace already set up).
- No live Docker Engine required — the importer test suite mocks
  `dockerode`; a real engine is only needed for manual UI verification.

## Automated validation

```bash
# Importer package — unit tests exercise validateDiscoveredAsset on every
# emitted shape (network assets, volume assets, fail-closed paths)
cd packages/importer-docker && pnpm test

# Frontend — infra detail renderers + component-detail integration
cd packages/frontend && pnpm test -- docker-details component-observation

# Full gates for changed packages
cd packages/importer-docker && pnpm lint && pnpm typecheck && pnpm build
cd packages/frontend && pnpm lint && pnpm typecheck && pnpm build
pnpm build   # root — workspace integrity

# Playwright workload (spec coverage per AGENTS.md)
cd playwright && pnpm e2e
```

Expected: all green; `docs:api:check`/contract tests unaffected (no API
change); `docs:importers:check` unaffected (no manifest/config change —
verify anyway via root docs scripts).

## What the tests must prove (spec → test mapping)

| Spec requirement | Test location |
|---|---|
| FR-001..004 network identity/allowlist/exclusions | `importer-docker/test/infra.test.ts`, `importer.test.ts` |
| FR-005..008 volume identity/allowlist/exclusions + df join | `importer-docker/test/infra.test.ts`, `importer.test.ts` |
| FR-009..013 instances:[], categories, labels allowlist, fail-closed, parity | `importer.test.ts` |
| FR-015..016 allowlisted UI sections, no details dump | `frontend/src/test/unit/` |
| SC-002 exclusions | negative assertions in infra/importer tests |
| SC-004 fail-closed | `importer.test.ts` — list/inspect/df rejection cases |

## Manual smoke (optional, needs a Docker Engine)

1. Run a Hub- or Agent-bound Docker import against any engine.
2. Open a `network` component → Details card shows the Network section
   (driver/scope/flags/attachments/labels).
3. Open a `volume` component → Details card shows the Volume section
   (driver/scope/size/refCount when the driver reports usage).
4. `docker network inspect` / `docker volume inspect` the same objects
   and diff: no IPAM subnets, no endpoint IPs/MACs, no mountpoint paths,
   no driver options anywhere in the UI.
