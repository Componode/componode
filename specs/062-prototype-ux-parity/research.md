# Research: Prototype UX parity polish

**Date**: 2026-11-03 | **Feature**: `062-prototype-ux-parity`

## Decisions

### D1 — Typeface delivery

**Decision**: Bundle `Geist Variable` and `Geist Mono Variable` through
`@fontsource-variable/geist` and `@fontsource-variable/geist-mono`, then map
`--font-sans`/`--font-mono` to those families in the global Tailwind theme.

**Rationale**: This is the same self-hosted delivery model Componode requires
(no runtime Google font dependency), while matching the prototype's visual
voice. Variable packages avoid maintaining per-weight files and preserve the
prototype's feature settings (`cv11`, `ss01`) and tabular numerals.

**Alternatives considered**: Keep system fonts (rejected — explicit user goal
is prototype font parity); use the `geist` package (rejected — Fontsource is a
simpler Vite/CSS integration and does not depend on framework font APIs).

### D2 — Scope of prototype tokens and canvas utility

**Decision**: Import `ux/styles.css` once from `src/main.tsx` and apply
`.ux-root` at the application wrapper level, rather than only inside
`UxShell`.

**Rationale**: Auth routes are outside the shell but must render the same
prototype palette, radii, font, and `bg-grid` utility. Hoisting the existing
scope avoids duplicating tokens or creating a second auth-only stylesheet.

**Alternatives considered**: Duplicate `bg-grid` in `index.css` (rejected —
two sources of truth); wrap only auth pages in `ux-root` (rejected — still
splits authenticated vs public visual identity).

### D3 — Product Map placement

**Decision**: Restore `map` as a first-class Product detail tab between
Overview and Components. Dependencies keeps edge authoring, consumer lists,
and suggestion handling; it no longer hosts the topology canvas.

**Rationale**: The dedicated tab is the prototype's discoverable affordance and
matches "Hierarchy is the product." Keeping authoring on Dependencies preserves
the spec-059 work without duplicating or hiding the canvas.

**Alternatives considered**: Keep map inside Dependencies (rejected — lower
discoverability); put map inside Overview (rejected — Overview remains summary
metadata/links, while Map is a first-class inspection surface).

### D4 — Live context cues

**Decision**: Support optional nav badges keyed by nav item. Suggestions shows
the pending queue total; Import agents shows agents that need attention
(`OFFLINE` or `NEVER_CONNECTED`). Header gains a real Help/docs external link
and a Notifications link to `/settings/notifications` with no unread dot.

**Rationale**: Existing authenticated reads already provide these bounded
values. The cues restore the prototype's "live" density without copying
fixture labels or fabricating notification state.

**Alternatives considered**: Copy prototype badges literally (rejected —
fixture values); add a notification dot/dropdown (rejected — gap G15 has no
backend); restore "Halcyon · Production" (rejected — fictional workspace data).

### D5 — Governance

**Decision**: Amend ADR-127 with a placement amendment restoring the dedicated
Map tab, update `docs/ux.md` typeface/shell/topology language, and add the ADR
index back-pointer.

**Rationale**: ADR-127 explicitly removed the Map tab. A visible first-class
Map changes that ratified decision and must be recorded in the same governance
instrument, per the repository's ADR fidelity rule.

**Alternatives considered**: Treat this as cosmetic and skip governance
(rejected — tab placement is an architecture/user-journey decision, not just
CSS).
