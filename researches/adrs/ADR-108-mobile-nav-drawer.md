### ADR-108 — Mobile navigation drawer below `md`

> **Status:** Ratified

**Context**: `docs/ux.md` §9 records the product as desktop-first —
optimized for ≥1280px, "usable at ~768px", and explicitly *not designed for*
below 768px "except via a dedicated spec". The app-shell audit
(`researches/app_shell_layout_research.md`) verified that below 768px the
persistent `w-56` sidebar consumes ~58% of the viewport and crushes content.
Every reference shell (shadcn `Sheet`, Tailwind Catalyst slide-over, Linear)
solves this identically: the sidebar becomes an off-canvas drawer below the
breakpoint.

**Decision**:

1. **Drawer-only exception.** Below `md` (768px) navigation is an off-canvas
   left drawer (Radix `Dialog`-based `Sheet`), opened by a hamburger in the
   top bar that is visible only below `md`. This is the *entire* mobile
   concession — no other sub-768px layout work is implied.

2. **Single nav source.** The drawer renders the same `SECTIONS` groupings
   and admin-role gating as the desktop sidebar
   (`components/layout/nav-sections.ts`), so the two surfaces can never
   diverge.

3. **Mutually exclusive chrome.** The sidebar is `hidden md:flex`; the
   drawer content + overlay are `md:hidden`, and `AppShell` clears the
   drawer's open state on a `matchMedia("(min-width: 768px)")` change —
   drawer and sidebar can never be visible simultaneously and a crossover
   while open dismisses cleanly.

4. **`Ctrl+B` global shortcut** (consistent with `Ctrl+K`): toggles the
   sidebar collapse at ≥`md`, the drawer below `md`.

5. **Accessibility contract.** The drawer traps focus while open, closes on
   Escape/scrim/navigation, is `aria-label`ed, and returns focus to the
   hamburger trigger on close (Radix trigger/content in one `Sheet` root).

**Consequences**: `docs/ux.md` §9 is amended to cite this ADR. Mobile
*design* remains deferred — this is graceful degradation of the existing
chrome, not a mobile app commitment.

**Alternatives considered**: full responsive redesign — rejected (desktop-first
posture, disproportionate cost); keep sidebar squeezed below 768px — rejected
(verified crush to ~165px content); bottom-sheet/`vaul` — rejected (mobile-app
idiom, not nav chrome).
