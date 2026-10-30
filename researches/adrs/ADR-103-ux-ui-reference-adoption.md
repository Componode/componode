### ADR-103 — UX/UI reference adoption: sidebar shell, tree-first products, theming

> **Status:** Ratified

**Context**: Until now UX/UI decisions were scattered across unrelated ADRs
(ADR-010 stack, ADR-042 importer forms, ADR-072 error UX, ADR-080 pagination)
plus a WCAG AA mandate in spec 001 — or left entirely implicit. There was no
defined information architecture, no page templates, no state conventions, no
theming decision, and no UX at all for the headline concept (the Composable
Product Model). The flat top-nav does not scale past ~7 items, and the
dashboard was a duplicate link grid.

**Decision**: **Adopt `docs/ux.md` as the normative UX/UI reference.** All
feature specs and frontend implementations MUST follow it. Its binding
decisions:

1. **Sidebar shell**: persistent left sidebar with grouped sections (Catalog /
   Sources / Administration), collapsible to icons; slim top bar for
   breadcrumbs + identity. Replaces the flat top-nav.
2. **Tree-first Products view**: `/products` is an expandable indented
   COMPOSES tree (capability roots → platform children); search/filter
   flattens to a list. Node-edge graph visualization is deferred and requires
   its own ADR before implementation.
3. **Standard page anatomy**: list pages = header + filter bar +
   sortable table + pagination, filters in URL query; detail pages =
   breadcrumbs + entity header + tabs, same template for all entities.
4. **State matrix**: skeletons (not spinners), standard empty-state block with
   primary action, inline page/section errors with retry, distinct 403/404
   states.
5. **Theming**: dark mode shipped (system default + user-menu toggle,
   token-only colors), one accent `--primary` hue replacing the all-grayscale
   stock theme, compact density.
6. **Scope**: desktop-first (≥1280px optimized, usable ≥768px); no mobile
   design promise — recorded as a decision, revisitable only via spec.
7. **Global search**: `Ctrl+K` command palette is a v1 feature.
8. **Dashboard**: health + attention layout (attention-needed → stat cards →
   importer status → empty-install getting-started variant); the doc records
   layout intent only — the real dashboard requires its own feature spec.

**Rationale**: Componode's UX was emergent from implementation rather than
designed, and its core differentiator (product composition) was invisible in
the UI. A single normative doc gives specs a reference the way
`docs/data-model.md` does for schema, while keeping the decision *record* in
the ADR stream per project convention. The specific choices favor
catalog-management workflows (list/tree-shaped, dense, keyboard-friendly)
over graph exploration; the deferred items (graph canvas, mobile, activity
feed, customizable dashboard, custom importer widgets, density toggle) are
recorded as open decisions so they cannot silently drift back in.

**Consequences**: Existing pages predate this ADR (top-nav shell, link-grid
dashboard, stub `products.tsx`); conformance happens per-feature through the
spec-kit workflow, not a big-bang refactor. `docs/ux.md` §11 lists the open
decisions; each graduates to its own ADR or spec before implementation.

---

**Amended by ADR-118**: the "no in-app graph canvas" boundary on the product
Map is relaxed — a read-only relations canvas is ratified. Interactive graph
authoring remains out of scope (gap G31, needs its own ADR/spec).
