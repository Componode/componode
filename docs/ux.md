# UX & UI Reference — v1.1.0 baseline

> **Status**: Normative — ratified by ADR-103; this edition records the
> v1.1.0 redesign shipped by spec 029 (v0-generated design ported onto the
> existing stack). Feature specs and implementations MUST follow this
> document. Genuinely new binding decisions graduate to ADRs (ADR-104+).
> Where this file conflicts with a ratified ADR or the constitution, the
> more specific document wins.

This document is the single UX/UI reference for Componode: the design
system (tokens, components, patterns) plus the conventions every page must
follow. ADRs record *why*; this file records *what the UI must look like*.

---

## 1. Principles

1. **Data-heavy internal tool.** Density, scannability, and fast navigation
   beat visual flair.
2. **Desktop-first.** Optimized for ≥1280px, usable down to ~768px. The one
   sub-`md` concession is the off-canvas nav drawer (ADR-108).
3. **Hierarchy is the product.** The Composable Product Model must be visible
   in primary navigation and the primary Products view.
4. **Consistency over novelty.** Same table, same states, same badges, same
   page anatomy everywhere. Deviations need a reason in the spec.
5. **WCAG 2.1 AA is binding.** Keyboard reachability, focus-visible rings,
   4.5:1 contrast, screen-reader navigability — every page. Icon-only
   controls always carry an accessible name (`aria-label` or `sr-only` text).

---

## 2. Design tokens

All color/space/typography comes from the CSS custom properties in
`packages/frontend/src/ux/styles.css` and `index.css` — **never hardcoded**
hex or palette utilities (`bg-amber-500`, `text-red-600`) in components.

| Token group | Role |
|---|---|
| `background`/`foreground`, `card`, `muted`, `accent`, `border`, `input`, `ring` | Base surfaces and text |
| `primary`, `secondary`, `destructive`, `warning`, `info` (+ `-foreground` pairs) | Semantic emphasis — status tones come from these |
| `sidebar-*` | Shell sidebar surfaces |
| `chart-1`…`chart-5` | Data visualization series only |
| `radius` scale (`rounded-md` etc.) | Consistent cornering |

- **Dark mode** ships via `next-themes`; tokens carry dark values. Default
  follows `prefers-color-scheme`; a picker lives in Settings → Appearance.
- **Status tone mapping is centralized** in `src/ux/lib/domain.ts`
  (`*_META` tables: label + tone per enum). New enums get a META entry;
  components render `StatusBadge`/`*Badge` wrappers, never ad-hoc colors.
- **Density**: compact by default (`text-sm` tables, tight rows). A
  user-facing density preference is a recorded gap, not shipped (§10).

## 3. Component inventory

- **Primitives** (`src/ux/components/ui/`): the shadcn/Radix set —
  button, input, field, select, switch, checkbox, radio-group, textarea,
  input-group, dialog, alert-dialog, dropdown-menu, tabs, card, table,
  badge, avatar, skeleton, spinner, alert, tooltip, sonner toasts.
- **Patterns** (`src/ux/components/patterns/`):
  - `page-header` — `PageContainer` (+ `width="narrow"` for forms) and
    `PageHeader` (media/title/description/meta/actions).
  - `states` — `EmptyState`, `ErrorState`, `NotFoundState`, `ForbiddenState`,
    `TableSkeleton`. **Every async region uses these.**
  - `status-badge` — enum → tone chips (`StatusBadge`, `RoleBadge`,
    `LifecycleBadge`, `CredentialStatusBadge`, `RunStatusBadge`, …).
  - `primitives` — `MonoValue` (copyable ids), `RelativeTime` (null-tolerant
    "—"), `DescriptionList`, `ProviderMark`, `ListToolbar` (search +
    filter selects + result count), `ConfirmDialog`, `DangerZone`
    (type-to-confirm destructive block), `EntityHistory`, `ActivityFeed`,
    `FieldRow`/`SettingRow`.
- **Forms** (`src/ux/components/forms/`): `FormPage`/`FormSection` page
  anatomy and list editors — mutations wired by the owning page.

## 4. Information architecture

### Shell

Persistent collapsible sidebar (grouped: Catalog, Organization, Sources,
Administration; Admin hidden below `ADMIN`), slim header with breadcrumbs +
`Ctrl+K` command palette (real `/search` results + nav actions), theme
toggle, user menu. The sidebar collapses to icons; the state persists per
tab (`sessionStorage`).

### Route map (post-cutover `/` tree)

| Route | Page | Min role |
|---|---|---|
| `/` | Dashboard | — |
| `/products`, `/products/new`, `/products/import`, `/products/:slug` (+`/edit`,`/history`) | Product tree, authoring, detail | editor for writes |
| `/components`, `/components/:slug` (+`/promote`,`/history`) | Catalog, promotion, detail | editor for writes |
| `/component-groups`, `…/:slug` | Groups | — |
| `/suggestions` | Edge-suggestion queue | — |
| `/importers`, `…/new`, `…/:id` (+`/edit`,`/runs/:runId`) | Import operations | — |
| `/agents`, `/agents/:id` | Import Agent fleet | ADMIN |
| `/lobs`, `…/:slug`, `/teams`, `…/:slug` | Org entities | editor for writes |
| `/users`, `/users/:id` | User management | ADMIN |
| `/sessions` | Own sessions | — |
| `/credentials`, `…/new`, `…/:id` (+`/edit` rotate) | Credential store | ADMIN |
| `/activity` | Audit feed | ADMIN |
| `/settings/*` | profile, appearance, security, notifications / workspace, authentication, session-policy, advanced | admin sections ADMIN |
| `/standards`, `/standards/wiring` | Design system + wiring contract docs | — |
| `/login`, `/register`, `/auth/oidc/callback` | Auth (no shell) | — |

### Internal links

Routes never hand-write absolute paths — the `ux()` helper in
`src/ux/lib/paths.ts` prefixes every internal link, so the tree can be
mounted anywhere during staging.

## 5. Conventions

### Page anatomy

List pages: `PageHeader` (title/description/primary action) → `ListToolbar`
(search + filters + result count) → table/card collection. Detail pages:
`PageHeader` (badge meta + actions) → `Tabs` → tab content cards; the
`DangerZone` renders last. Detail pages resolve entities through
**filtered-list strategies** where the API lacks a detail GET (orgs, users).

### `?tab=` convention

Every tabbed detail page keeps the active tab in `?tab=` (replace, not
push) via the **`useValidatedTab` hook** — unknown/missing values fall back
to the first tab so deep links never render an empty panel. Never hand-roll
`searchParams.get("tab")`.

### State matrix

| State | Convention |
|---|---|
| Initial loading | `TableSkeleton`/shaped `Skeleton` — no full-page spinners |
| Refetch | Keep existing data (TanStack `placeholderData`); no layout shift |
| Empty | `EmptyState` — icon, one-line explanation, one primary action |
| Error | `ErrorState` with `errorMessage(err)` + retry |
| 403 Forbidden | `ForbiddenState`/in-page notice; UI guards are advisory — the API enforces |
| 404 | `NotFoundState` linking back to the section root |

`errorMessage`/`isNotFound`/`isForbidden` in `src/ux/lib/api-state.ts`
classify API errors uniformly.

### Mapper rule

**No component reads API contracts directly.** API types convert to view
types through one mapper per entity under `src/api/mappers/` (`catalog`,
`dashboard`, `operations`, `suggestions`) — enum narrowing with
documented fallbacks, null-first-class fields kept explicit, masked
`keyHints` passed verbatim (never values). View types live in
`src/ux/lib/view-types.ts`; mappers are unit-tested.

### Mutations

TanStack Query hooks own all writes; `onSuccess` invalidates the read
query keys. Success → `toast.success`; failure → `toast.error(e.message)`
(API `message` already human-readable — never invent copy). Destructive
actions go through `ConfirmDialog`/`DangerZone` (type-to-confirm for
slugged entities); 409/423 conflicts surface as toasts, not crashes.
Simulated saves (`setTimeout`, optimistic fake rows) are forbidden in
shipped routes.

### Secrets

- Credential values are write-only: forms POST `secrets`, afterwards only
  masked `keyHints` render.
- `AGENT_MANAGED` credentials send `{env}`/`{file}` **references**, never
  values.
- Agent enrollment tokens display exactly once in `EnrollmentTokenPanel`
  (prefilled from `window.location.origin`) — never persisted or refetched.
- Password-reset tokens surface once in a toast for admin copy-out
  (`POST /auth/password/reset`); there is no email delivery yet.

### Formatting & voice

- Timestamps relative for recent events (`RelativeTime`), absolute on
  hover; nullable timestamps render "—".
- Slugs/ids in `font-mono`. Sentence case. Button labels are verbs.
- Domain terms verbatim (Component, ComponentInstance, DigitalProduct,
  ComponentGroup, Importer); edge names as phrases ("X consumes Y"),
  never bare enums.

## 6. Auth surfaces

Login, register, and the OIDC callback live outside the app shell with the
two-column `AuthShowcase` layout. The backend redirects OIDC outcomes to
`/login?error=oidc_*`; the login page renders those inline. The callback
page renders `?error=` states and forwards to `/` on success — the session
cookie is already set by the backend 302.

## 7. Feature flags & gap governance

Runtime-flagged gaps live in **`src/ux/lib/flags.ts`**, each tied to a
detailed entry in **`researches/ux-rewrite-gaps.md`**:

- A flag is added **only** alongside its gap-registry entry (flagged
  surface, missing backend capability, resolution plan).
- The flagged UI renders its defined fallback — hidden column, disabled
  control, or a notice naming the gap — never a fake interaction.
- When the backend capability lands, the flag flips and the gap entry is
  marked resolved; gap specs are the next roadmap items after v1.1.0.

## 8. Scope boundaries

- ≥1280px optimized, ~768px usable; sub-`md` = nav drawer only (ADR-108).
- No in-app graph canvas — the product "Map" is the textual relations view;
  a node-edge canvas still requires its own ADR (deferred).
- No dashboard widget customization, no notification backend, no TOTP —
  all flagged gaps, not hidden bugs.

## 9. Open decisions

Deferred — each needs its own ADR or spec:

- Graph visualization of the COMPOSES DAG
- Mobile/tablet support beyond the nav drawer
- Custom importer-form widgets beyond the generic manifest/JSON editor
- Per-user display preferences consumed app-wide (gap G20)
- Notification delivery (gap G15), TOTP (gap G16), session concurrency
  controls (gap G17), workspace profile fields (gap G18), retention/export
  operations (gap G19)
