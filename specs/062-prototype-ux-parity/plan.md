# Implementation Plan: Prototype UX parity polish

**Branch**: `062-prototype-ux-parity` | **Date**: 2026-11-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/062-prototype-ux-parity/spec.md`

## Summary

Close the remaining visual and information-architecture drift from the approved
v0 prototype while preserving the production app's live data, permissions, and
state behavior. The frontend will bundle Geist Sans/Mono as the shared
typeface, move the UX token scope above route layouts so public auth surfaces
receive the same canvas/grid treatment as the shell, restore a dedicated
read-only Map tab on Product detail, and add live context cues only where an
existing API supplies truthful values (pending Suggestions count and agents
needing attention). Prototype decorations without a real destination or
backend — notification dot, simulated workspace/environment label, role
preview — remain omitted. Governance updates document the ADR-127 placement
change and the ratified typeface change.

## Technical Context

- **Language/Version**: TypeScript 6
- **Primary Dependencies**: React 19, Vite, React Router, TanStack Query,
  Tailwind CSS 4, shadcn/Radix primitives, `next-themes`, lucide icons,
  `@fontsource-variable/geist`, `@fontsource-variable/geist-mono`
- **Storage**: N/A — no API, schema, or persisted state change
- **Testing**: Vitest + Testing Library under `packages/frontend/src/test/unit`
- **Target Platform**: Self-hosted web dashboard; desktop-first, usable at
  768px
- **Project Type**: Monorepo web application (`packages/frontend` only)
- **Performance Goals**: No unbounded reads; badge reads reuse existing list
  contracts and stay bounded. Bundled variable fonts are the only new static
  assets.
- **Constraints**: WCAG 2.1 AA, token-only colors, real API data only, no dead
  controls, no mock labels/counts, read-only Product Map
- **Scale/Scope**: Auth surfaces, global shell header/sidebar, Product detail
  tab layout, shared visual tokens, focused frontend tests, UX/ADR docs

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

**Pre-design gate**: PASS

- **I — Single-Organization, Self-Hosted**: No tenant/workspace data model is
  introduced; context cues come from existing single-deployment state.
- **II — Importer-First**: No importer contract or runtime change.
- **III — Two-Level Taxonomy**: No taxonomy change.
- **IV — Environment-as-Instance**: Existing status/lifecycle semantics are
  preserved; no `environment` field is added.
- **V — Factual vs. Meaning Layer**: The UI presents existing queue, agent,
  and topology reads; it does not derive or author product relations.
- **VI — Test-First**: Failing tests for global visual assets, Product detail
  tab routing/placement, and live shell badges precede implementation.
- **VII — Observability from Day One**: Pure view/navigation changes; existing
  API request instrumentation is unchanged.

**Post-design gate**: PASS. The design keeps all reads bounded and existing,
does not invent unavailable context, and records the Product Map placement
change as an ADR amendment rather than silently contradicting ADR-127.

**Ratified in**: ADR-103 (`docs/ux.md` normative), ADR-118 (read-only map
constraints, amended by ADR-127), ADR-127 amendment (dedicated Map placement),
and `docs/ux.md` updates for global tokens/typeface/context cues.

## Research Summary

See [`research.md`](research.md). Key decisions: bundle the Geist variable
fonts locally through Fontsource; apply the existing `ux-root` token scope at
the app level so auth and shell routes share the same tokens; restore Map as a
separate tab while leaving authoring and relation lists on Dependencies; use
pending Suggestions and non-connected Import Agents as bounded live context
cues; render only controls with real behavior/destinations.

## Data Model and Contract

See [`data-model.md`](data-model.md) and
[`contracts/visual-parity-contract.md`](contracts/visual-parity-contract.md).
There are no API contract changes. The UI contract defines the global visual
baseline, Product detail tab identifiers (`overview`, `map`, `components`,
`dependencies`, `activity`), and live badge semantics.

## Project Structure

### Documentation (this feature)

```text
specs/062-prototype-ux-parity/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   └── visual-parity-contract.md
├── quickstart.md
├── checklists/
│   └── requirements.md
└── tasks.md
```

### Source Code (repository root)

```text
packages/frontend/
├── package.json                     # Geist Fontsource dependencies
├── index.html                       # body-level ux-root for auth, shell, and portals
└── src/
    ├── main.tsx                     # imports shared font + UX token CSS
    ├── app.tsx                      # mounts global preference sync
    ├── index.css                    # font theme tokens
    ├── ux/
    │   ├── styles.css               # visual tokens, bg-grid utility, prefs
    │   ├── ux-shell.tsx             # removes now-redundant CSS import/root
    │   ├── lib/nav.ts               # live badge keys for nav items
    │   ├── components/app/
    │   │   ├── app-header.tsx       # real Help/docs + Notifications controls
    │   │   └── app-sidebar.tsx      # live badge rendering
    │   └── components/products/
    │       └── product-detail.tsx   # dedicated Map tab
    └── test/unit/
        ├── theme-tokens.test.ts     # Geist/font/grid token coverage
        ├── product-map.test.tsx     # map behavior remains covered
        ├── ux-parity.test.tsx       # new route/shell parity tests
        └── use-validated-tab.test.tsx # tab resolution coverage

docs/ux.md                            # updated normative visual baseline
researches/adrs/ADR-127-*.md          # amendment restoring dedicated Map tab
researches/adrs/ADR-103-*.md          # back-pointer for new amendment
researches/architecture-decisions.md  # ADR index wording/back-pointer
docs/roadmap.md                       # shipped/next-entry update at completion
```

**Structure Decision**: Reuse the existing UX layer rather than introducing a
parallel design system. Global visual identity is centralized in CSS tokens;
ProductMap remains the sole topology component; `nav.ts` stays the single
navigation definition while `app-sidebar.tsx` resolves live cue values.

## Complexity Tracking

No constitution violations — section not required.
