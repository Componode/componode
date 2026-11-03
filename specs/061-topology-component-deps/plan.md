# Implementation Plan: Component dependencies in Product topology

**Branch**: `061-topology-component-deps` | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/061-topology-component-deps/spec.md`

## Summary

Add a "Depends on components" lane to the Product topology card on the
Dependencies tab. Direct Product→Component `DEPENDS_ON` targets render as typed
nodes with operational-status dots, selection/inspection, `+N` expansion, and
Open-component navigation — reusing the spec-059 lane mechanics. The empty
state only renders when the product has no relations of any kind, and card copy
stops conflating dependency kinds. The change is frontend-only: the product
detail read already returns `components.declared` with per-edge `sources`
(`DIRECT`/`GROUP`/`INHERITED`) and `instances` for the status rollup. Governance:
ADR-127 amendment supersedes the component-exclusion refinement; `docs/ux.md`
topology notes are updated in the same change.

## Technical Context

- **Language/Version**: TypeScript 6
- **Primary Dependencies**: React 18, Vite, TanStack Query, React Router, Tailwind, shadcn/ui
- **Storage**: N/A — no API or schema change; reuses `ProductDetail.components.declared` + `instances`
- **Testing**: Vitest + Testing Library (`packages/frontend/src/test/unit/product-map.test.tsx`, `ux-mappers.test.ts`)
- **Target Platform**: Self-hosted web dashboard; desktop-first, usable at 768px
- **Project Type**: Monorepo web application (`packages/frontend` only)
- **Performance Goals**: Bounded — zero new requests; node count capped by existing 4-per-lane + `+N`
- **Constraints**: Read-only; one hop; direction-true arrows/labels; WCAG 2.1 AA; tokenized status via `HEALTH_META`
- **Scale/Scope**: One new lane kind, one new node kind, mapper extension, empty-state copy, tests, ADR amendment + docs

## Constitution Check

**Pre-design gate**: PASS

- **I — Single-Organization, Self-Hosted**: No tenant model changes.
- **II — Importer-First**: No importer changes.
- **III — Two-Level Taxonomy**: Component taxonomy unchanged.
- **IV — Environment-as-Instance**: Operational status comes from existing
  `ComponentInstance.status` rollup (`worstStatus`); `GONE` rows are already
  excluded by the default read and are never presented as Component health.
- **V — Factual vs. Meaning Layer**: Only presents existing human-authored
  `DEPENDS_ON` edges; creates or infers nothing.
- **VI — Test-First**: Failing unit tests (lane render, direct-only filtering,
  empty-state suppression, inspection/navigation, `+N`) precede implementation.
- **VII — Observability from Day One**: Pure view change; existing request
  logging covers the reused read path.

**Post-design gate**: PASS. The view consumes fields already returned by the
product detail read; ADR-118's data-true constraint is strengthened (a fetched
relation stops being silently dropped), and the ADR-127 amendment records the
refinement change.

**Ratified in**: ADR-016, ADR-048, ADR-110, ADR-118 (as amended by ADR-127),
ADR-127 amendment (this feature), ADR-128 (provenance vocabulary).

## Research Summary

See [`research.md`](research.md). All data needed is already fetched for the
Components tab; the lane is a presentation join over `components.declared`
filtered to `DIRECT` sources plus the existing `worstInstanceStatus` rollup.
The rejected alternatives were the v0-draft Q4 fallback (collapsed
`N components · M groups` node — a second, inconsistent disclosure mechanism)
and literal mockup restoration (semantically inverted `COMPOSES` semantics).

## Data Model and Contract

See [`data-model.md`](data-model.md) and
[`contracts/topology-view-model.md`](contracts/topology-view-model.md). No API
contract change: `ProductDetail` is unchanged. The frontend view-model gains a
`TopologyComponent` node kind and a `dependsOnComponents` family on
`ProductTopology`; the map gains a `component` node kind.

## Project Structure

### Documentation (this feature)

```text
specs/061-topology-component-deps/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   └── topology-view-model.md
├── quickstart.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source areas affected by the implementation

```text
packages/frontend/src/
├── api/
│   ├── mappers/catalog.ts          # mapProductTopology gains dependsOnComponents (DIRECT-only + status rollup)
│   └── types.ts                    # no change (ComponentDepRef/DepSource already present)
├── ux/
│   ├── lib/view-types.ts           # + TopologyComponent; ProductTopology.dependsOnComponents
│   ├── components/products/
│   │   └── product-map.tsx         # + "component" node kind, lane, inspection, copy fixes
│   └── app/products/$slug.tsx      # pass instances/catalog into topology mapping
└── test/unit/
    ├── product-map.test.tsx        # lane, direction, selection, +N, empty-state tests
    └── ux-mappers.test.ts          # dependsOnComponents mapping, DIRECT-only filter

researches/adrs/ADR-127-product-map-topology-in-dependencies.md  # Amendment 2
docs/ux.md                                                        # topology note update
```

**Structure Decision**: Existing `packages/frontend` seams only — the mapper is
the single conversion seam (spec-059 convention); `product-map.tsx` absorbs the
new node kind rather than a new component, matching its existing generic
`TopologyNode`/`laneColumn` machinery.

## Complexity Tracking

No constitution violations — section not required.
