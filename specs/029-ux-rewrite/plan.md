# Implementation Plan: Frontend UX Rewrite (v0 Design Baseline)

**Branch**: `029-ux-rewrite` | **Date**: 2026-10-23 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/029-ux-rewrite/spec.md`

## Summary

Port the v0 prototype (Next.js, fixtures) into `packages/frontend` as a
parallel UX tree mounted at `/ux/*`, wired to the real API via the existing
TanStack Query hooks and new per-entity mappers. Work proceeds route-by-route
in the `lib/wiring.ts` order; each completed route drops all fixture imports
and covers the five states. When every in-scope route passes, the `/ux` tree
becomes the app, the old pages/components are deleted, and the documented
UX/UI baseline ships in v1.1.0. Backend gaps are never worked around with
invented data — they are flagged and annotated in
`researches/ux-rewrite-gaps.md` for follow-on specs.

## Technical Context

**Language/Version**: TypeScript 6 (`tsc -b`), React 19.3.1

**Primary Dependencies**: Vite 7, React Router 7 (`createBrowserRouter`),
TanStack Query 5, Tailwind CSS 4 (`@tailwindcss/vite`), shadcn/ui primitives
(@radix-ui individual packages), react-hook-form + zod, sonner, recharts,
cmdk, lucide-react, next-themes. Prototype-only deps to evaluate during port:
`radix-ui` (unified package → map to existing `@radix-ui/*` packages),
`input-otp`, `tw-animate-css` (vs existing `tailwindcss-animate`), `cn`,
`shadcn` runtime package, `@vercel/analytics` (drop — self-hosted tool).

**Storage**: N/A (frontend only; API contracts unchanged)

**Testing**: Vitest 5 + Testing Library + jsdom (existing `src/test` setup);
mapper unit tests; per-route state-matrix smoke tests

**Target Platform**: Browser SPA served by the backend container (unchanged)

**Project Type**: Web application — frontend package in pnpm/Turborepo monorepo

**Performance Goals**: Match current SPA expectations (staleTime 60s query
defaults retained); no new perf budget introduced

**Constraints**: No `dangerouslySetInnerHTML` (ADR-085); `safeUrl()` for all
external hrefs; secrets/tokens never rendered (ADR-107); error envelope
`{code,message,details}` drives UI error copy (ADR-071); `?tab=` deep-links
preserved; both UIs coexist until cutover

**Scale/Scope**: ~40 prototype routes across 5 user stories; ~99 prototype
components; 16 existing hook files; 22 existing pages to retire at cutover

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Single-Organization | PASS | No tenant concepts touched |
| II. Importer-First | PASS | Importers untouched; UI renders manifest `configSchema` (existing contract) |
| III. Two-Level Taxonomy | PASS | Category/provider/resourceType rendering unchanged; status metadata reads the same enums |
| IV. Environment-as-Instance | PASS | UX keeps `lifecycle` vs `status` distinct per `lib/domain.ts` metadata |
| V. Factual vs. Meaning | PASS | Human curation preserved: promote flow, suggestion accept/dismiss, product edges |
| VI. Test-First | PASS — enforced in tasks | Mapper tests and route state tests are written before each port; see tasks.md ordering |
| VII. Observability | PASS | No new runtime paths; frontend error surfaces consume existing error envelope |

Security gate (AGENTS.md § Security): PASS — UI adds read/mutation calls only;
no new endpoints (openapi.yaml untouched, ADR-104 N/A); secrets/tokens
excluded from view models by FR-006/FR-010; no raw HTML injection.

**Post-Phase-1 re-check**: PASS — design introduces no DB, API, or
contract-surface changes; `/ux` mount and `src/ux/` tree are additive.

## Project Structure

### Documentation (this feature)

```text
specs/029-ux-rewrite/
├── plan.md              # This file
├── research.md          # Phase 0 output — port mechanics + staging decisions
├── data-model.md        # Phase 1 output — view-model entities + mapping rules
├── quickstart.md        # Phase 1 output — per-route validation guide
├── contracts/
│   └── wiring.md        # Route ↔ endpoint ↔ mutation matrix (ported from
│                        # the prototype's lib/wiring.ts, React Router paths)
└── tasks.md             # Phase 2 output (/speckit-tasks)
```

External contract artifacts (pinned reference, `v0-componode-dpam@9b040bc`):
`docs/ux-rewrite-instructions.md`, `docs/ux-data-model.md`, `lib/wiring.ts`,
`lib/domain.ts`, `lib/mock-data.ts` (fixture types = view-model shapes).

### Source Code (repository root)

```text
packages/frontend/src/
├── ux/                      # NEW — ported prototype tree, mounted at /ux/*
│   ├── app/                 # Route components (prototype app/(app) ported to
│   │                        #   React Router elements)
│   ├── components/          # Ported prototype components (ui/, patterns/,
│   │                        #   domain sections); reuses existing components/ui
│   │                        #   where an equivalent already exists
│   ├── lib/                 # Ported domain.ts, format.ts, nav.ts; flags.ts
│   │                        #   (feature-flagged gap elements); NO mock-data.ts
│   └── ux-shell.tsx         # Prototype shell/layout + theming port
├── api/
│   ├── hooks/               # Existing TanStack Query hooks (reused; new hooks
│   │                        #   added only for endpoints that have none)
│   └── mappers/             # NEW — one mapper per entity, API type → view model
├── pages/                   # EXISTING UI — untouched until cutover phase,
│   │                        #   then deleted
├── components/              # EXISTING UI components — deleted at cutover,
│   │                        #   except pieces the new tree legitimately reuses
└── routes.tsx               # Adds /ux/* subtree during staging; at cutover the
                             #   /ux tree moves to / and old routes are removed

researches/
└── ux-rewrite-gaps.md       # NEW — running gap control file (FR-016/FR-016a)

docs/
└── ux.md                    # Updated at baseline phase → new UX/UI baseline
```

**Structure Decision**: Parallel tree staging. `src/ux/` mirrors the
prototype's structure so ported files keep their organization and
side-by-side diffing stays easy; the `/ux/*` route prefix makes both UIs
reachable at once (FR-001). Cutover is a mechanical move: `/ux` → `/`, delete
old `pages/` + retired `components/`, drop the prefix redirect.

## Research & Design Artifacts

- [research.md](research.md) — staging mechanism, Next.js→React Router port
  mapping, dependency mapping, mapper pattern, flag mechanism, tab validation
- [data-model.md](data-model.md) — view-model entities, nullability rules,
  derive rules per `ux-data-model.md`
- [contracts/wiring.md](contracts/wiring.md) — route wiring matrix
- [quickstart.md](quickstart.md) — validation walkthrough

## Complexity Tracking

No constitution violations — table intentionally empty.
