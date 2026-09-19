# UX & UI Reference

> **Status**: Normative — ratified by ADR-103. Feature specs and
> implementations MUST follow this document. Genuinely new binding decisions
> graduate to ADRs (ADR-104+). Where this file conflicts with a ratified ADR
> or the constitution, the more specific document wins.

This document is the single UX/UI reference for Componode. It consolidates
already-ratified decisions, defines the conventions that were previously
implicit, and records explicit open decisions. It relates to the ADRs the same
way `docs/data-model.md` does: the ADRs are the record of *why*; this file is
the working reference for *what the UI must look like*.

---

## 1. Principles

1. **Data-heavy internal tool.** Componode is a catalog-management tool, not a
   marketing surface or a graph explorer. Density, scannability, and fast
   navigation beat visual flair.
2. **Desktop-first.** Optimized for ≥1280px, usable down to ~768px. No mobile
   design promise (see §9).
3. **Hierarchy is the product.** The Composable Product Model must be visible
   in the primary navigation and the primary Products view — not buried in
   detail pages.
4. **Consistency over novelty.** Same table, same states, same badges, same
   page anatomy everywhere. Deviations need a reason in the spec.
5. **WCAG 2.1 AA is binding.** Ratified in `specs/001-foundation/spec.md`
   (FR-026, SC-012). Keyboard reachability, focus-visible rings, 4.5:1
   contrast, screen-reader navigability — on every page, not just the ones the
   spec named.

---

## 2. Already decided (consolidated from ratified sources)

These are recorded here for convenience. The ADRs/spec remain authoritative.

| Decision | Source |
|---|---|
| Stack: React 18 + Vite + TanStack Query + Tailwind + shadcn/ui | ADR-010 |
| Importer config forms rendered from each importer's JSON Schema | ADR-042 |
| Importer run progress reporting (phases) | ADR-062 |
| Global TanStack Query `onError` → toast/redirect; form mutations use inline field errors via `parseFieldErrors` | ADR-072 |
| Pagination: cursor-based for high-cardinality lists, offset for low-cardinality; `usePaginatedQuery` abstracts both | ADR-080 |
| Error responses are `{code, message, details?}`; never leak internals | ADR-071, ADR-096 |
| `GET`/`HEAD` are side-effect-free (no "run on click of a link") | ADR-094 |
| All `href`s validated with `safeUrl()`; no `dangerouslySetInnerHTML` | ADR-085 |
| WCAG 2.1 AA conformance | spec 001, FR-026 |

---

## 3. Information architecture

### Layout shell

A **persistent left sidebar** with grouped sections; a slim top bar carrying
breadcrumbs / page context (left) and a `Ctrl+K` search trigger, theme toggle,
user identity + sign-out (right).

```text
┌────────────┬──────────────────────────────────────────┐
│ Componode  │ Breadcrumbs            user  ☾  Sign out │
│────────────┼──────────────────────────────────────────┤
│ Catalog    │                                          │
│  Dashboard │                                          │
│  Products  │              <page content>              │
│  Components│                                          │
│  Component │                                          │
│   Groups   │                                          │
│ Sources    │                                          │
│  Importers │                                          │
│ Admin*     │                                          │
│  Users     │                                          │
│  Sessions  │                                          │
│  Settings  │                                          │
└────────────┴──────────────────────────────────────────┘
```

- *Admin section is visible only to `ADMIN` role (current behavior, kept).*
- Sidebar is collapsible to icons; state persists per browser session
  (`sessionStorage` — per tab, not across devices).
- Group labels render in `text-xs uppercase text-muted-foreground`.
- The flat top-nav (current `nav.tsx`) is replaced by this shell.

### Route map

| Route | Page | Sidebar section |
|---|---|---|
| `/` | Dashboard | Catalog |
| `/products`, `/products/:slug` | Products tree, product detail | Catalog |
| `/components`, `/components/:id` | Component catalog, detail | Catalog |
| `/component-groups` | Component groups | Catalog |
| `/importers`, `/importers/:configId/runs/:runId` | Importer configs and runs | Sources |
| `/users` | User management | Admin |
| `/sessions` | Active sessions | Admin |
| `/settings` | App settings (OIDC, registration) | Admin |
| `/login`, `/register`, `/auth/oidc/callback` | Auth (no shell) | — |
| `/lobs`, `/teams` (spec 005) · *(future)* `/people` | Org entities | Catalog → "Organization" group |

### Breadcrumbs

Slug-based, on every detail page: `Products / payments-api`,
`Components / github.com/org/repo`. Each crumb links to its list root.
Detail pages resolve the final crumb to the entity's slug/name via a crumb
context (the raw route id is never shown when a slug is available); UUID
segments without a detail page are omitted.

### Global search (Ctrl+K)

A `cmdk`-style command palette is a **v1 feature**: jump to any product,
component, importer, or group by name or slug; plus nav actions ("Go to
Settings"). At catalog scale (tens of thousands of components, ADR-080),
search is the primary navigation, not the sidebar.

---

## 4. Page templates

### List page

```text
┌─ Page header: title, description, primary action ───────────┐
├─ Filter bar: search input + filter chips/selects ───────────┤
├─ Table (or tree-table): sortable headers, compact rows ─────┤
└─ Pagination footer ─────────────────────────────────────────┘
```

- Row click (or a dedicated name link) navigates to the detail page.
- Sortable column headers where the API supports it (ADR-081).
- Filters live in the URL query string — shareable, back-button friendly.
- Default filters follow the constitution: `RETIRED` components and `GONE`
  instances are excluded unless explicitly requested — surface this as a
  visible toggle, not a hidden default.

### Detail page

```text
┌─ Breadcrumbs ───────────────────────────────────────────────┐
├─ Header: name, type badge, slug, lifecycle, owner, actions ─┤
├─ Tabs ──────────────────────────────────────────────────────┤
│  <tab content: sections or embedded tables>                 │
```

This anatomy is the **standard template for all entities** — products,
components, groups, users. Entity-specific tabs differ; the chrome does not.

---

## 5. Products: the hierarchy view

The `/products` primary view is an **expandable indented tree** of the
COMPOSES DAG: products with no COMPOSES parent render as roots — usually
Business Capability / Customer-Facing products, but an unparented Platform
is a root too;
Platform products nested beneath. Typing in search or applying a filter
flattens the tree to a normal list.

- A product with multiple parents (legal in a DAG) appears under each parent;
  a "shared" indicator marks duplicates.
- Retired products excluded by default (constitution IV) with a visible toggle.

### Product detail tabs

| Tab | Content |
|---|---|
| Overview | Description, owners, LOB, counts (N composed-by, M composes, K components, J instances) |
| Composition | Labeled sections: **Composed by** (parents, upward), **Composes** (children, downward), **Consumes from** (CONSUMES_FROM edges — a different relationship type, never mixed into the COMPOSES tree), and for `PLATFORM` products **Consumed by** (reverse lookups) |
| Components | The product's component dependencies split into **Declared** (direct `DEPENDS_ON_COMPONENT` edges) and **Inherited** (via composed products, annotated with the `via` product) — reuses the catalog table |
| Instances | Component instances grouped by environment, with the same Declared/Inherited split |

### Deferred: graph visualization

A node-edge canvas (e.g., React Flow) is **explicitly deferred** and requires
its own ADR before implementation. Reasons: accessibility cost under WCAG AA,
build complexity, and catalog workflows are list-shaped. When it arrives, it
is a secondary "Map" tab — never the primary view.

---

## 6. State matrix

Every page and every async region implements these states. Toast feedback
(ADR-072) is *transient* feedback — it never replaces a page-level state.

| State | Convention |
|---|---|
| Initial loading | Skeleton placeholders shaped like the content (`Skeleton`). No full-page spinners. |
| Refetch / pagination | Keep existing data; small progress indicator; no layout shift. |
| Empty | Standard empty-state block: icon, one-line explanation, one primary action ("Import your first components →"). Never a blank table. |
| Page error | Inline error panel with retry button. |
| Section error | Section-level error + retry; the rest of the page survives. |
| 403 Forbidden | Distinct "You don't have permission" state; no retry. |
| 404 | Dedicated not-found page; link back to the section root. |

### Formatting

- **Timestamps**: relative for recent events ("3m ago"), absolute ISO on
  hover/tooltip.
- **Enums → badges** with a fixed color map, identical everywhere:
  `ACTIVE`/`RUNNING` green-ish, `STOPPED` neutral, `ERROR`/`GONE` red,
  `RETIRED` muted, `PENDING`/`QUEUED` yellow. Status color must mean one thing
  across the whole app.
- **Identifiers**: slugs rendered in `font-mono` where shown.

---

## 7. Forms and voice

- shadcn `Form` + react-hook-form + `parseFieldErrors` (ADR-072) is the
  required form stack; importer config forms are JSON-Schema-driven (ADR-042).
- Labels above inputs; inline errors directly below the field.
- Destructive actions require a confirm dialog (`Dialog`), never a bare click.
- Sentence case everywhere ("Run import", not "Run Import").
- Domain terms verbatim: Component, ComponentInstance, DigitalProduct,
  ComponentGroup, Importer. No synonyms ("asset", "service") in UI copy.
- Button labels are verbs or verb phrases.

---

## 8. Theming

- **Dark mode**: defined and shipped. Default follows `prefers-color-scheme`;
  explicit toggle in the user menu. All colors come from the CSS token set —
  no hardcoded `bg-white`/`text-black` in components.
- **Accent**: one `--primary` hue for interactive/primary elements; everything
  else stays neutral. The stock all-grayscale theme is replaced.
- **Density**: compact by default — `text-sm` in tables, reduced row padding.
  No density toggle in v1.

---

## 9. Scope boundaries

- Optimized for ≥1280px; usable at ~768px (sidebar collapses to icons).
- Below 768px the app renders but is not designed for: no mobile layouts, no
  touch-target work — **with one ratified exception**: navigation becomes an
  off-canvas drawer (hamburger in the top bar) so the shell degrades
  gracefully instead of crushing content. That is the only sub-768px change;
  see ADR-108. Anything further is a recorded decision, not an oversight —
  revisit only via a dedicated spec.
- No in-app graph canvas (see §5). No activity feed, no customizable
  dashboard widgets, no per-user layout customization in v1.

---

## 10. Dashboard intent

The dashboard is a **health + attention** overview, not a navigation hub
(the sidebar already navigates):

1. **Attention needed** (top; hidden when empty): failed importer runs,
   `ERROR`/`GONE` instances, reconciliation anomalies.
2. **Stat cards**: products (by type), components (by lifecycle), instances
   (by status), last import time.
3. **Importer status**: last run per configured importer — status, when,
   assets found/created/updated.
4. **Empty install**: getting-started strip ("Configure your first importer")
   replaces all of the above.

This section records *layout intent only*; the real dashboard requires its own
feature spec before implementation.

---

## 11. Open decisions

Deferred — each needs its own ADR or spec before implementation:

- Graph/map visualization of the COMPOSES DAG (§5)
- Mobile/tablet support (§9)
- Activity feed / audit-log UI
- Real dashboard spec (§10)
- Custom importer-form widgets beyond the generic JSON-Schema renderer
  (ADR-042 marks these v1.1)
- Density toggle, per-user layout preferences
- Nav entries for LineOfBusiness / Team / Person (route map §3)
