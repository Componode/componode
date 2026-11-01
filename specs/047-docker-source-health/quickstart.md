# Quickstart: Validate Docker Source Health + ImporterSource UI

**Feature**: `047-docker-source-health` | **Date**: 2026-11-01

Runnable checks that prove the wave end-to-end. See
`contracts/docker-observation.md` for the payload/status table and
`contracts/frontend-surfaces.md` for the UI surfaces.

## Prerequisites

- `pnpm install && pnpm build` at repo root.
- Importer unit/integration tests run against dockerode fixtures/mocks —
  no live daemon required (precedent: `importer-docker/test/importer.test.ts`,
  `backend/test/integration/docker-import.test.ts`).

## 1. Health-aware status + observation (US1/US2, SC-001/003)

```bash
pnpm --filter @componode/importer-docker test
pnpm --filter @componode/backend test
```

Expect:

- Every row of the status table verified: running+healthy → RUNNING,
  running+starting → RUNNING, running+no-healthcheck → RUNNING,
  running+unhealthy → ERROR, OOMKilled → ERROR (incl. exited+OOM),
  created/paused/exited → STOPPED, dead/restarting/removing/unknown →
  ERROR; absent-from-run → GONE via existing reconciliation.
- `rawConfig.dockerObservation` present on emitted instances with only
  allowlisted fields; `Health.Log`/test commands never read or emitted.
- `validateDiscoveredAsset` exercised on all emitted assets.
- Backend integration: unhealthy container → instance `ERROR` →
  product depending on the component reports degraded health
  (ADR-112 rollup verification, SC-002).

## 2. ImporterSource UI (US3, SC-004)

```bash
pnpm --filter @componode/frontend test   # unit coverage
# manual: pnpm dev, sign in
```

Expect:

- `/sources` lists all Sources with identity, importer, bound config,
  status badge, last complete run, membership counts; empty state when
  none; `?tab=`/filter/search work.
- `/sources/:id` tabs show identity/bound config, run history,
  memberships, audit activity; `UNMONITORED`/`RETIRED` explanation shown.
- ADMIN: Retire → confirm → `RETIRED`; Reactivate →
  `ACTIVE`/`UNMONITORED` per binding; non-ADMIN sees no lifecycle buttons.
- Delete a config → its Source renders `UNMONITORED`; a new config
  reporting the same engine identity rebinds on next run.

## 3. Observation on instance detail (US2 clarified)

- Component detail → Instances table → expand a Docker instance row →
  allowlisted observation fields render; absent payload → no control;
  non-Docker instances unaffected.

## 4. Tag suggestions (US4, SC-005)

- Component with `details.composeProject`/`composeService` → edit dialog
  shows `compose:<p>` and `service:<p>.<s>` chips; accept adds tag on
  save; already-present tags not re-offered.
- Invalid/overlong values produce no chip; nothing writes without save.

## 5. Docs + housekeeping

- `docs/importers/docker.md` documents observation fields, status rules,
  exclusions; ADR-121 Amendment 1 + `architecture-decisions.md` index
  updated; `docs/openapi.yaml` documents `instances`/`ComponentInstance`.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green on
  changed packages (`importer-docker`, `frontend`, `backend` tests).
