# App Shell Layout Research — SaaS Reference Model for Componode

> **Purpose**: Identify the modern SaaS layout structure Componode's app shell
> should be modeled after, reverse-engineer its CSS structural practices, and
> audit the current implementation (`specs/004-ux-shell`) against that model —
> verified against the running application, not just the code.
>
> **Scope**: Part I covers application chrome — sidebar, top bar, content
> grid, cards, breakpoints. Part II covers the visual layer — brand palette,
> iconography, pills, drop lists, charts. Page-level templates
> (list/detail/tree) are governed by `docs/ux.md` §4–§5 and are out of scope
> except where the shell or visual layer constrains them.
>
> **Relationship to existing work**: `docs/ux.md` (ratified by ADR-103) is
> normative and already prescribes this shell shape. This document does not
> override it; it validates it against external references, records verified
> defects, and proposes deltas. Where a recommendation conflicts with a
> ratified decision (mobile scope, `docs/ux.md` §9/§11), that conflict is
> flagged explicitly rather than silently resolved.

---

## Executive Summary

1. **The industry has converged on one shell**: a fixed "inverted-L" chrome —
   persistent grouped left sidebar + slim top bar — with the content area as
   the only scrolling region. Linear, shadcn/ui's `dashboard-01` block,
   Tailwind UI's Catalyst `SidebarLayout`, Vercel, GitHub, and every
   internal-developer-portal in our niche (Backstage, Port, Cortex) ship
   variations of the same skeleton. Componode's `docs/ux.md` §3 prescribes
   exactly this, and the current implementation already realizes most of it.

2. **Chosen reference model: shadcn/ui `sidebar` + `dashboard-01` block, read
   through Linear's chrome principles, cross-checked against Catalyst and the
   IDP niche.** Rationale: (a) it is the native pattern of our own component
   stack — Tailwind + Radix + the same token model we already use; (b) it is
   the only reference that ships a complete, accessible solution for the three
   problems our shell still has (scroll ownership, collapse state machine,
   mobile drawer); (c) Linear contributes the density and "chrome recedes,
   content leads" principles that fit a data-heavy internal tool.

3. **Part II (added 2026-09-18) covers the visual layer**: a green brand
   palette (emerald, WCAG-AA-verified on the running app), pill patterns for
   tag-like content, drop-list upgrades for the filter bar and entity pickers,
   and a chart-library decision (Recharts — Tremor is unmaintained). The
   structural model in §4 is unchanged; Part II layers visual language on top.

4. **The current implementation conforms on structure but fails on scroll
   ownership and sub-768px behavior.** Verified in a live browser at
   1440 / 1280 / 768 / 390 px in both themes:
   - The sidebar and top bar **scroll away with page content** on any page
     taller than the viewport — the `h-screen` aside is in document flow, not
     sticky. Every reference model pins the chrome. (Defect, §6.1)
   - Below 768 px the `w-56` sidebar consumes ~58% of the viewport; content is
     crushed to ~165 px and wraps/overlaps. The references solve this with a
     slide-over drawer (shadcn `Sheet`, Catalyst slide-over). `docs/ux.md` §9
     records mobile as deferred — this proposal recommends the minimal
     graceful-degradation version of the drawer, not a mobile design effort.
     (§6.2, conflict flagged §7)
   - At exactly 768 px the sidebar does not collapse, and the dashboard's
     importer-status row collides (config name overlapped by the `FAILED`
     badge). (§6.3)
   - Dark mode, icon-rail collapse, state matrix, and the ⌘K pattern are all
     verified working and consistent with the references.

### Decisions ratified in review (2026-09-18)

| # | Decision | Outcome |
|---|---|---|
| D1 | Packaging | Bugfix spec `NNN-bugfix-chrome-scroll` (R1 scroll-pin + R4 row-collision/auto-collapse) + feature spec `NNN+1-ui-refresh` (R2 drawer + R6–R10) — numbers assigned at spec creation per D10 |
| D2 | Brand palette | Deep emerald `hsl(163 94% 24%)` + white text; dark `hsl(158 64% 52%)` + dark text |
| D3 | Brand/status separation | Hue gap (163° vs 142°) + treatment rule: brand only on solid fills/links/rings; status only on tinted pills + dots |
| D4 | Mobile drawer | Ships in the refresh spec as graceful degradation; ux.md §9 amendment or ADR-108 records the exception |
| D5 | Faceted filters | All core enum values + `/component-groups`; pattern applies wherever enum filters exist; API already supports multi-value `IN` — frontend only |
| D6 | Charts | Recharts + `ChartContainer`; first = importer run-history stacked bar (endpoint exists); dashboard donuts deferred to dashboard spec |
| D7 | Micro-layer | `--radius: 0.625rem`; system font stack (Inter deferred); icon wells adopted |
| D8 | Pill semantics | Taxonomy pills decorative in tables; facet pills removable; no pill-as-link |
| D9 | Mobile-drawer ratification | ADR-108 ("nav drawer permitted below 768px; no other mobile design") + `ux.md` §9 amendment citing it |
| D10 | Spec mechanics | Wait for `013-credential-store` to merge; then `speckit-specify` for `NNN-bugfix-chrome-scroll` (R1+R4) first, then `NNN+1-ui-refresh` (R2+R6–R10) — each on its own branch |
| D11 | Residual styling defaults | Active nav keeps neutral `bg-accent`; primary hover = `hsl(163 94% 20%)`; `Ctrl+B` sidebar shortcut; facet pills inside the filter button; `StatusBadge` dot+label everywhere statuses render; drawer = off-canvas Sheet `<md` sharing `SECTIONS`, hamburger in top bar `<md` only; spec inventories every enum-filter surface for the three-tier drop-list rule |

---

## 1. Method & sources

References were chosen to cover (a) the design system we already use,
(b) the most-cited "modern SaaS" shell, and (c) our actual niche — internal
developer portals / software catalogs, the SaaS category Componode belongs to.

| Source | Why it was studied | Type |
|---|---|---|
| shadcn/ui `sidebar` docs + `dashboard-01`/`sidebar` blocks | Native pattern of our stack (Tailwind + Radix + token CSS vars) | Primary (docs + registry source) |
| Linear (`linear.app`, "How we redesigned the Linear UI" + community teardowns) | The most-cited modern SaaS chrome; density + keyboard-first model | Primary + secondary |
| Tailwind UI Catalyst `SidebarLayout` docs | Tailwind Labs' own app-shell prescription incl. mobile slide-over | Primary (docs) |
| Backstage, Port, Cortex | Niche equivalents: self-hosted/SaaS software catalogs with the same sidebar + table + entity-tab anatomy | Secondary comparisons + official docs |
| Tailwind UI "Application shells — multi-column" | Sticky-column shell variants | Primary (docs) |

Claims about *our* UI were verified by rendering the app locally
(`docker compose` Postgres + `BOOTSTRAP_ADMIN_*` backend + Vite dev server on
:5173) and screenshotting every shell page at 1440×900, 1280×800, 768×1024,
and 390×844, light and dark. Reproduction steps are in the appendix.

---

## 2. Reference layouts analyzed

### 2.1 shadcn/ui — `sidebar` primitive + `dashboard-01` block (primary model)

Structure (from the official docs and registry source):

```text
SidebarProvider                    ← owns collapse state, Ctrl+B shortcut,
│                                    mobile open state, width CSS vars
├── Sidebar (collapsible="icon")
│   ├── SidebarHeader (sticky)     ← logo / workspace switcher
│   ├── SidebarContent             ← scrollable nav; SidebarGroup +
│   │                                SidebarGroupLabel (uppercase muted)
│   ├── SidebarFooter (sticky)     ← user menu
│   └── SidebarRail                ← hover hit-area to toggle
├── SidebarInset                   ← the content column
└── SidebarTrigger                 ← button in the site header
```

Verified structural specifics worth copying:

- **Two separate state machines**: desktop collapse (`open`) vs mobile drawer
  (`openMobile`), driven by `useIsMobile()` at a **768 px breakpoint**. Below
  it the sidebar stops being a column and becomes a Radix `Sheet`
  (dialog-drawer with overlay, focus trap, ESC close). Desktop collapse state
  is cookie-persisted; ours uses `sessionStorage` (equivalent, per ux.md).
- **Geometry**: `--sidebar-width: 16rem` default (we use `w-56` = 14rem),
  `--sidebar-width-icon: 3rem` (we use `w-14` = 3.5rem), header `h-12`/`h-16`
  (we use `h-14`). All within normal range — no change warranted.
- **Scroll ownership**: the sidebar is `position: sticky; top: 0; height:
  100svh` inside the flex row — the chrome never scrolls; only the inset
  scrolls. **This is the piece we are missing.**
- **Site header anatomy** (`SiteHeader`/`sidebar-07` block):
  `SidebarTrigger` + vertical `Separator` + `Breadcrumb` on the left;
  search/user actions on the right; `sticky top-0` on several blocks.
- **Content rhythm** (`dashboard-01`): `p-4 md:p-6`, `gap-4 md:gap-6`,
  stat-card grid `md:grid-cols-2 xl:grid-cols-4`, sections stacked with
  heading + card. Our dashboard uses the same rhythm at `md:grid-cols-3`.

### 2.2 Linear — chrome principles

From Linear's own redesign post and third-party teardowns:

- **"Inverted-L" chrome**: fixed sidebar + top bar; the content area is the
  only thing that changes. The frame never reloads or scrolls — spatial
  memory is preserved. This is the strongest argument for pinning our chrome.
- **Density**: `text-sm` rows, `py-1.5`-scale item padding, muted
  `uppercase` section labels, icons at `h-4 w-4`. Our sidebar already matches
  this almost class-for-class.
- **Keyboard-first**: `⌘K` palette is primary navigation at scale — matches
  ux.md §3's decision that search is the primary nav at catalog scale.
- **Skeleton states over spinners** — already our state matrix (ux.md §6).
- **Minimal chrome**: one accent hue, everything else neutral — matches our
  token set (`--primary` blue + neutral grays).

### 2.3 Tailwind UI Catalyst — `SidebarLayout`

- Desktop: static sidebar column; **mobile: the sidebar is a slide-over**
  (fixed, `translate-x` transition, backdrop). A mobile-only top bar carries
  the hamburger. This is the same drawer solution as shadcn `Sheet`,
  confirming the pattern is the industry default, not a shadcn idiosyncrasy.
- Cards/containers use `ring-1 ring-*/5` + `shadow-xs` (a *hairline*, not a
  shadow) — identical to our `border` + `rounded-lg` card treatment.

### 2.4 Niche equivalents — Backstage, Port, Cortex

- All three use **left sidebar + top bar + tabbed entity detail + catalog
  tables** — the same information architecture our route map already has.
- Their dashboards converge on **stat/scorecard cards + an attention/health
  feed** — validating ux.md §10's "health + attention" dashboard over a
  nav-hub dashboard. Port/Cortex lead with scorecard-style stat cards;
  Backstage leads with catalog-owned entities.
- Lesson: in this niche, dense tables beat visual flair; the sidebar is
  secondary navigation after search. Consistent with ux.md principles 1 & 3.

---

## 3. Reverse-engineered structural practices (what to copy, not the branding)

| Practice | Reference | Our status |
|---|---|---|
| Inverted-L shell: `flex` row, `h-dvh`, content owns the only scrollbar | All | **Broken** — chrome scrolls with page |
| Sidebar `sticky top-0 h-svh` (or shell `h-dvh overflow-hidden` + `overflow-y-auto` on `<main>`) | shadcn, Catalyst, Linear | **Missing** |
| Mobile: sidebar becomes drawer w/ overlay + focus trap at <768 px | shadcn `Sheet`, Catalyst | **Missing** (deferred by ux.md §9) |
| Desktop: collapse to icon rail (~48–56 px) w/ tooltips; persisted | shadcn, Linear | ✅ Implemented (`w-14`, sessionStorage, `title` tooltips) |
| Grouped nav, `text-xs uppercase text-muted-foreground` labels | shadcn, Linear | ✅ Implemented |
| `Ctrl+K`/`⌘K` palette as primary search; kbd hint in a fake input in the bar | Linear, shadcn | ✅ Implemented |
| Top bar: context/breadcrumbs left, search+theme+user right; `h-12`–`h-16` | shadcn SiteHeader | ✅ Implemented (`h-14`) |
| Content rhythm `p-6`, `gap-4/6`, stat-card grid → `md:grid-cols-3/4` | dashboard-01 | ✅ Implemented |
| Cards: hairline border, `rounded-lg`, `bg-card`, no heavy shadow | Catalyst, shadcn | ✅ Implemented |
| One accent hue on neutral gray; dark mode from the same tokens | Linear, shadcn | ✅ Implemented |
| `Ctrl+B` sidebar toggle shortcut + a trigger in the header | shadcn | Missing (footer-only trigger) |

---

## 4. Chosen model and rationale

**Model the shell after shadcn/ui `dashboard-01` + `sidebar` block, applying
Linear's chrome principles (fixed frame, density, keyboard-first), validated
by Catalyst and the IDP niche.**

This is not a green-field choice so much as a confirmation: the existing
implementation already *is* this pattern's skeleton — it was built from
`docs/ux.md` §3, which prescribes the same anatomy. The references were used
to (a) confirm the anatomy is current industry practice, (b) extract the
three structural details we lack (scroll ownership, header trigger,
mobile drawer), and (c) confirm which things are *deliberately* different
(`w-56`/`w-14` widths, `sessionStorage` persistence, no `SidebarRail`) and
therefore not defects.

Explicitly rejected alternatives:

- **Top-navbar SaaS shell** (marketing-style horizontal nav): fails at our
  nav depth (4 sections, 12+ items, admin-gated) — every reference in the
  niche uses a sidebar.
- **Rail + second column** (Catalyst rail shell, Discord-style): our
  navigation is flat; a second column would sit empty. Catalyst's own docs
  say the rail is wrong for flat navs.
- **Graph-first dashboard** (node-edge canvas): already deferred by
  ux.md §5 pending its own ADR; the niche confirms list-shaped workflows.

---

## 5. Verified audit of the current implementation

Environment: `docker compose` Postgres + backend (bootstrap admin) on :3000,
Vite dev server on :5173. Breakpoints: 1440×900, 1280×800, 768×1024,
390×844. Both themes. All findings below were **observed in rendered
output**, not inferred from code.

### Conforms

- Grouped sidebar (Catalog / Organization / Sources / Administration),
  active-route highlight, ADMIN gating, `w-56`↔`w-14` collapse persisted in
  `sessionStorage` — matches ux.md §3 and the reference anatomy.
- Top bar: breadcrumbs left; search trigger w/ `Ctrl+K` hint, theme toggle,
  user menu right — matches the `SiteHeader` anatomy.
- Dashboard: attention feed → stat cards (`md:grid-cols-3`) → importer status
  → empty-install strip — matches ux.md §10 and the IDP dashboard pattern.
- Dark mode verified: token-driven, no hardcoded colors observed, badge
  contrast holds.
- State matrix verified: skeletons, empty states w/ icon + action, status
  badges, 768 px filter-grid reflow to 2 columns.

### Defects (each reproduced in-browser)

**D1 — Chrome scrolls away (all breakpoints).** On any page taller than the
viewport, the sidebar and top bar scroll off with the content; the left
column under the sidebar is empty background. Cause:
`app-shell.tsx` uses `min-h-screen` + in-flow `<aside class="h-screen">`; the
`overflow-y-auto` on `<main>` never engages because the column has no bounded
height. Every reference pins the chrome. *Verified: scrolled
`/components` at 1440×500 — sidebar nav and top bar left the viewport.*

**D2 — Below 768 px the shell collapses the wrong element.** The `w-56`
sidebar keeps its width and the content column shrinks to ~165 px: headings
clip ("Products" truncated by the primary action), the attention list's
badge/text/timestamp overlap, filter inputs truncate, stat cards squeeze to
~150 px. Top bar overflows (user menu clipped). The references' answer is
the slide-over drawer + hamburger in the bar. *Verified: dashboard and
products at 390×844.*

**D3 — 768 px boundary.** ux.md §9 promises "usable at ~768px (sidebar
collapses to icons)" — at exactly 768 px the sidebar stays fully expanded
(manual collapse only) and the dashboard importer-status row shows the
config name colliding with the `FAILED` badge (truncation/flex-shrink
issue in the row's `min-w-0` span). *Verified: dashboard at 768×1024.*

**D4 — Minor: no header-level sidebar trigger.** shadcn and Linear keep a
trigger in the chrome (header `SidebarTrigger`, `Ctrl+B`). Ours lives only in
the sidebar footer — usable, but a user on a collapsed rail must target the
small footer icon. Cheap addition: trigger icon left of breadcrumbs.

---

## 6. Recommendations

Ordered by value/effort. Each is a diff sketch, not a redesign — the
structure is right; the scroll model and the <768 px story are what's
missing.

**R1 (bugfix — no spec needed beyond bugfix spec): pin the chrome.**
Change `app-shell.tsx` to `h-dvh overflow-hidden` on the shell and let
`<main>`'s existing `overflow-y-auto` finally work:

```diff
-<div className="flex min-h-screen bg-background">
+<div className="flex h-dvh overflow-hidden bg-background">
   <Sidebar />
   <div className="flex min-w-0 flex-1 flex-col">
     …<main className="flex-1 overflow-y-auto">
```

Alternative with identical effect: `sticky top-0 h-dvh self-start` on the
`<aside>` + `sticky top-0` on `<header>`. The first option matches the
Linear/shadcn model more literally (chrome never participates in scroll).

**R2 (needs its own spec — ux.md §9/§11): adopt the shadcn mobile pattern
as graceful degradation.** Below `md`, render the sidebar inside the
existing Radix `Dialog` (a `Sheet` equivalent: fixed left, `w-72`, backdrop,
ESC/backdrop close, focus trap — Radix gives us all of it) and add a
hamburger `SidebarTrigger` in the top bar. This is **not** mobile design —
it's the 30-line structural fix that keeps the app *usable* below 768 px,
exactly the spirit of §9 ("renders but not designed for") while satisfying
basic navigation. A true mobile layout effort remains deferred.

**R3 (with R1/R2): add a `SidebarTrigger` + `Ctrl+B`** in the top bar (left
of breadcrumbs) — reference-standard, trivial cost, and required anyway as
the mobile drawer's affordance.

**R4 (bugfix): fix the 768 px row collision** in the dashboard
importer-status list — the label span needs proper `min-w-0`/shrink so the
badge can't overlap; and **auto-collapse to the icon rail below `lg`** (or
default `collapsed` when `matchMedia('(max-width: 1024px)')` on first load)
to deliver §9's "usable at ~768px" promise.

**R5 (deferred, no action):** `SidebarRail`, `inset`/`floating` variants,
resizable sidebar — reference features that add nothing for a data-heavy
internal tool at v1.

---

## 7. Conflicts with ratified decisions

- **Mobile (resolved 2026-09-18).** ux.md §9 records "below 768px renders but
  is not designed for" and §11 defers mobile to a dedicated spec. Decision
  from the review: the minimal navigation drawer (R2) ships inside the
  UI-refresh feature spec as *graceful degradation*, not a mobile layout.
  Because the drawer contradicts the letter of §9, the spec must record the
  exception — and `ux.md` §9 should be amended (or an ADR-108 written) to
  ratify "nav drawer permitted below 768px; no other mobile design". See §8.
- **Nothing else conflicts.** R1, R3, R4 implement or repair behavior the
  docs already prescribe (persistent chrome, ~768 px usability).

## 8. Open questions for review — resolved 2026-09-18

1. ~~Is R2 in-scope as graceful degradation, or does §9 require a full mobile
   spec before *any* drawer ships?~~ → **Drawer ships in the refresh spec**;
   ux.md §9 amendment/ADR-108 records the exception (residual mechanics in
   Round 2 below).
2. ~~Auto-collapse below `lg`?~~ → **Yes** (part of R4 bugfix spec; Linear
   precedent noted but 768px usability is the ratified promise).
3. ~~`h-dvh` shell vs `sticky` chrome?~~ → **`h-dvh overflow-hidden` shell**
   (R1) — matches the reference model literally; spec must verify
   `scrollIntoView`/anchor behavior on detail pages.
4. ~~Trigger in top bar or footer only?~~ → **Top bar trigger** (R3),
   which is also the mobile drawer's affordance.

---

# Part II — Vibrant-friendly visual language

Added 2026-09-18. Scope: color (green brand), iconography, pills, drop lists,
charting, and the micro-details that make modern SaaS feel friendly rather
than corporate — without breaking `docs/ux.md` §8's "one accent hue, neutral
everything else" rule or the WCAG 2.1 AA binding (constitution/spec-001).

## 9. Additional references for the visual layer

| Source | What was taken |
|---|---|
| Supabase | The strongest proof that a green-branded developer tool can look vibrant, not corporate: bright emerald accent on near-black dark UI; green used for *interactive* elements while semantic states keep their own hues |
| Attio / Dub / Cal.com | The "vibrant-friendly" cohort: pill-shaped filters, soft tinted icon wells, `rounded-xl` cards, generous use of muted tints |
| shadcn/ui `charts` + `data-table` (tasks demo) | Official patterns: `ChartContainer` + `--chart-N` CSS vars over Recharts; **faceted filter** dropdowns (button + count pill + searchable checkbox popover) for enum columns |
| Linear / GitHub labels | Dot + tinted-pill conventions for status vs taxonomy |

## 10. Green brand palette (verified on the running app)

`ux.md` §8 mandates exactly one `--primary` hue; the current blue
(`hsl(221 83% 40%)`) is a placeholder, not a ratified color. Proposed
**emerald** palette — a token-level change in `index.css`, zero component
edits:

| Token | Light | Dark | WCAG evidence |
|---|---|---|---|
| `--color-primary` | `hsl(163 94% 24%)` (≈ emerald-700 `#047857`) | `hsl(158 64% 52%)` (≈ emerald-400 `#34d399`) | White-on-primary **5.48:1** (AA ✓); dark-fg-on-primary ≈ **7:1** ✓ |
| `--color-primary-foreground` | `hsl(0 0% 100%)` | `hsl(163 90% 10%)` | — |
| `--color-ring` | match primary | match primary | focus-visible rings keep AA |

**Rejected candidates** (computed, not vibes): emerald-600 `#059669`
(white text 3.77:1 — fails AA), green-600 `#16a34a` (3.30:1 — fails),
Supabase `#3ECF8E` with white text (2.0:1 — fails; Supabase only gets away
with it by using *dark* text on the bright green — an option kept in the
open questions).

**Verified**: injected the tokens into the live app via `<style>` override —
emerald primary buttons, links, and focus rings render correctly in light
and dark; no component references the blue directly (all token-driven, as
ux.md §8 requires).

**Brand-vs-status collision — the honest problem.** Our status map already
uses green for `ACTIVE`/`RUNNING`/`COMPLETED` (`--color-success`,
`hsl(142 …)`). With an emerald brand (~160–163°) the two greens are
adjacent hues. Mitigations, in order of preference:
1. Keep `--color-success` at 142° (forest) vs brand at ~163° (teal-shifted
   emerald) — distinct enough at badge scale, and *context* disambiguates:
   brand green only ever appears on interactive elements (buttons, links,
   focus rings, active nav); success green only on status pills/dots.
2. Shift brand further toward teal (`hsl(170 …)`) if the adjacency still
   reads as one hue.
3. *Not* recommended: moving success off green — "green = healthy" is a
   stronger convention than brand purity.

## 11. Iconography

- **Stay on `lucide-react`** (already a dependency; the shadcn default;
  ~1,500 icons, tree-shaken, stroke style matches the minimal aesthetic).
- **Evaluated and rejected**: Phosphor (friendlier, has `duotone` weight —
  the most "vibrant" option — but a second icon family + migration cost for
  marginal gain); Tabler/Heroicons (same trade-off, weaker shadcn fit).
- **Adopt the icon-well pattern** for vibrancy instead of a new set: icons
  inside `h-9 w-9 rounded-lg bg-primary/10 text-primary` containers
  (empty states, stat cards, importer type markers) — this is how
  Attio/Linear add color without repainting the whole UI.
- Enrich sidebar/stat-card semantics: give each importer type its own
  Lucide glyph (`Github`, `Cloud`, `Ship`, `Globe`, `Plug`…) — sources
  become scannable at a glance.

## 12. Pills for tag-like content

The existing `Badge` is already `rounded-full` — the foundation is right.
Gaps vs the references:

- **Status pills** (`StatusBadge`): add the **dot + label** convention —
  `• FAILED` — colored dot carries semantics, so pills stay readable at
  small sizes and in peripheral vision (Linear/GitHub style). Cheap:
  prepend `<span class="h-1.5 w-1.5 rounded-full bg-current">`.
- **Taxonomy pills** — component `category`, `provider`, `ComponentGroup`,
  product `type`: currently plain text/table cells. Render as **neutral
  tinted pills** (`bg-secondary text-secondary-foreground`, or
  `bg-primary/10 text-primary` for group membership) — visually distinct
  from *status* pills, per the "status color means one thing" rule.
- **Facet pills** — active filters render as removable pills under/next to
  the filter button (`Category: service ×`) — shadcn data-table pattern;
  makes URL-filter state visible without reading the address bar.

## 13. Drop lists — replace free text and native selects

Two verified audit findings make this the highest-value UX upgrade:

- **D5 — `component-filters.tsx` uses five free-text inputs for
  enumerable data.** `lifecycle` and `status` are **controlled enums**
  (DB CHECK constraints); `category`/`provider` are `SELECT DISTINCT`-able;
  `group` is an entity reference. Free text allows invalid values, offers
  no discoverability, and looks dated. Replace with **faceted dropdown
  filters**: button → popover → searchable checkbox list (Radix `Popover`
  + `cmdk`, both already installed) → applied filters shown as pills.
  Multi-select also removes the current one-value-per-dimension limit.
- **D6 — `edge-picker.tsx` uses a native `<select>` for products** —
  unstyled vs the design system, no search, will not scale to hundreds of
  products. Replace with a **cmdk combobox** (search + keyboard nav),
  same primitive the Ctrl+K palette already proves.
- Keep Radix `Select` for genuinely short fixed lists (page size, sort,
  role pickers); combobox for entity pickers; faceted popover for filters.
  This three-tier rule is exactly the shadcn convention.

## 14. Charts

Decision: **Recharts v3 + the shadcn `charts` wrapper pattern**
(`ChartContainer`, `--chart-1…5` CSS vars, shared tooltip/legend
components).

- Recharts is the React default (≈2.4M dl/wk, v3 is current, React 18/19),
  declarative JSX matching our codebase style, SVG output (a11y-friendlier
  than canvas — supports `<title>`/desc + real DOM for screen readers).
- **Tremor rejected**: last release 2025-01-13, React 19 support never
  landed, community treats it as unmaintained — fails our supply-chain bar.
- Nivo (500 kB+), ECharts/Chart.js (canvas, weaker a11y) rejected; **uPlot**
  noted as the escape hatch if we ever chart >10k-point time series
  (importer telemetry at scale).
- Concrete chart set for Componode: products-by-type and
  components-by-lifecycle **donuts** (or stacked bars) on the dashboard;
  importer run history **stacked bar** (created/updated/processed per run)
  on `/importers/:configId`; optional reconciliation-anomaly **area trend**.
  Series colors must reuse the semantic tokens (`--color-success`,
  `--color-destructive`, …) — ux.md §6: status color means one thing,
  charts included.
- **A11y is binding**: every chart ships with an accessible data
  table/`sr-only` summary — donuts need explicit percentages/legend, not
  color-only encoding.

## 15. The friendliness micro-layer (small diffs, big feel)

- **Radius**: `--radius: 0.5rem` → `0.625rem` (or `0.75rem`) softens every
  card/button/input through the token — the single cheapest "friendlier"
  change. Keep tables compact regardless (density is ratified).
- **Tinted icon wells** in empty states and stat cards (see §11).
- **Font**: optional `@fontsource-variable/inter` (self-hosted — no
  external CDN call, which matters for an offline-capable self-hosted
  tool). System stack is acceptable; Inter is the friendly-SaaS default.
  Open question below.
- **Micro-motion**: already partially present (`transition-colors`,
  `transition-[width]`); add `duration-200` ease to card hover borders and
  pill hover states — no new deps.

### Part II recommendations (extend §6)

- **R6** — Adopt the emerald tokens in §10 (index.css only).
- **R7** — StatusBadge dot variant + taxonomy pills + facet pills (§12).
- **R8** — Faceted filter popovers for the component catalog; cmdk combobox
  for entity pickers (§13). Highest UX-per-line value in this document.
- **R9** — Recharts + ChartContainer; first chart = importer run history
  stacked bar (data already exists); chart colors = semantic tokens.
- **R10** — Radius bump + icon wells (+ optional Inter Variable) (§15).

### New open questions (extend §8) — resolved 2026-09-18

5. ~~Deep emerald vs Supabase-style bright emerald?~~ → **Deep emerald**
   `hsl(163 94% 24%)` + white text (AA-certain; vibrancy delivered via
   pills/charts/icon wells).
6. ~~142°/163° separation sufficient, or teal shift?~~ → **Hue + treatment
   rule**: brand green restricted to solid fills/links/focus rings/active
   nav; status green restricted to tinted pills + dots. Context + 20° hue
   gap disambiguate; teal shift held in reserve if it still reads as one
   hue in practice.
7. ~~Inter Variable vs system stack?~~ → **System stack for now**; revisit
   if the refresh still feels cold after R6–R10 land.
8. ~~Interactive vs decorative pills?~~ → **Decorative taxonomy pills** in
   tables; interactivity limited to facet pills (removable `×`) and
   existing row links.

---

## Appendix — reproduction

```powershell
docker compose up -d                       # postgres + app (:3000)
pnpm --filter @componode/frontend dev      # vite on :5173, /api proxied
# login at http://localhost:5173/login with the .env bootstrap admin
# breakpoints: 1440x900, 1280x800, 768x1024, 390x844 — light + dark
```

Screenshots were taken with Playwright (login → storageState → per-viewport
captures of `/`, `/products`, `/components`, `/importers`, `/settings`, plus
a forced-scroll test and the collapsed-rail state). The docker `app`
container serves the last build; the Vite server serves the working tree.
