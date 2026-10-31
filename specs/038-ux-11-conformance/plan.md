# Implementation Plan: UX Conformance — v1.1.0 Review Corrections

**Branch**: `038-ux-11-conformance` | **Date**: 2026-10-30 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/038-ux-11-conformance/spec.md`

## Summary

Correct the non-conformities measured by the 1.1.0-vs-v0 UX conformance
review (2026-10-30), under a ratified decision record: ~20 defect fixes
with regression tests, deletions of fake controls, twelve new governed gap
entries (G21–G32) with matching `flags.ts` flags, prototype restorations
(auth surfaces, tokens, alerts, columns, copy), product-map consumption of
the already-fetched relation data, and the doc ratifications that make the
canvas, fonts, and descopes honest (new ADR + `docs/ux.md` + registry +
roadmap updates). Approach: batch the defects by surface area, fix
backend-side where the fix is a select column, extend mappers/view-types
where shaping changes, and land the governance bookkeeping in the same
change per the ADR-fidelity rule.

## Technical Context

**Language/Version**: TypeScript (strict), React 19, Vite; Node backend.

**Primary Dependencies**: React Router 7, TanStack Query, Tailwind v4
(`@theme` tokens), shadcn/ui + Radix, Kysely (backend select additions
only), sonner toasts.

**Storage**: PostgreSQL — read-path select additions only; no migrations.

**Testing**: Vitest + Testing Library (existing frontend suite); mapper
unit tests per `docs/ux.md` mapper rule; backend service tests for the
hrefs select fix.

**Target Platform**: `packages/frontend` SPA (+ one
`packages/backend` service select fix).

**Performance Goals**: None — page-load parity (joins added are on
existing queries).

**Constraints**: No new endpoints; no `sql.raw`; no new dependencies;
prototype is source of truth for layout/copy/states; `docs/ux.md` wins
conflicts; every gap deferred behind a flag + registry entry (FR-016
governance, spec 029).

**Scale/Scope**: ~35 changed/created files across `src/ux`,
`src/pages`, `src/api/{mappers,hooks}`, `packages/backend/src/services`,
`docs/`, `researches/`, plus a new ADR.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict |
|---|---|
| I. Single-org, no tenancy | Pass — no data-model change. |
| II–III. (DPAM model / importer-first) | Pass — UI-only corrections. |
| IV. Lifecycle vs status separation | Pass — GONE/RETIRED opt-ins preserve the distinction; no conflation introduced. |
| V. Spec-driven workflow | Pass — this spec + regression-test-first for defects. |
| VI. Test-first | Pass — every defect fix lands with a failing-then-passing regression test (frontend suite or backend service test). |
| VII. Security | Pass — removes an `error.message` leak, removes a self-admin default-role path, no secrets/surfaces weakened; no `sql.raw`, no `dangerouslySetInnerHTML`. |

No gate violations. Re-checked post-Phase-1: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/038-ux-11-conformance/
├── plan.md              # this file
├── research.md          # resolved plan-time verifications + fix locations
├── data-model.md        # gap-registry + flag entity shapes
├── quickstart.md        # validation walkthrough
└── tasks.md             # /speckit-tasks output
```

### Source Code (repository root)

```text
packages/frontend/src/
├── ux/
│   ├── app/                    # route pages (defect fixes + flag gates)
│   ├── components/
│   │   ├── app/                # header, sidebar, command-menu fixes
│   │   ├── admin/              # users-table wiring, credential/tables
│   │   ├── agents/ catalog/ dashboard/ importers/ org/ products/ settings/
│   │   ├── patterns/           # status-badge guards, domain meta
│   │   └── ui/sidebar.tsx      # dead cookie write removal
│   ├── lib/                    # domain.ts META, flags.ts, format.ts
│   └── styles.css              # radius scale
├── pages/                      # login/register/oidc-callback restorations
├── api/mappers/                # neutral-enum fallbacks, new view fields
└── app.tsx                     # ErrorBoundary → ErrorState

packages/backend/src/services/
└── dashboard-service.ts        # slug-select + href fix (FR-001)

docs/                           # ux.md amendments, roadmap sync
researches/                     # ux-rewrite-gaps.md entries, new ADR, index
```

## Phase 0 — Research (resolved; see research.md)

All unknowns were resolved by direct code inspection during planning —
no external research needed:

1. Importer-card `lastRun`: **wire it** from `DashboardSummary.lastRuns`
   (already fetched shape: `configId, runId, status, completedAt,
   assetsProcessed`) — no new endpoint.
2. Attention hrefs: backend selects `components.name` but not
   `components.slug`; add slug to the `errorInstances` and
   `sunsetComponents` selects and emit `/components/{slug}`.
3. `rotateAgentCredential` on `PENDING_ENROLLMENT`: **accepted** — the
   service rotates unconditionally; no backend change.

## Phase 1 — Design

See `data-model.md` (flag + gap-entry shapes) and `quickstart.md`
(validation walkthrough). No `contracts/` — no API shape changes
(href *values* change, not the schema).
