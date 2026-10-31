# Feature Specification: Display Preferences — consume ux.prefs app-wide

**Feature Branch**: `041-display-prefs`

**Created**: 2026-10-31

**Status**: Draft

**Input**: Gap-registry entry G20 (`researches/ux-rewrite-gaps.md`). `/ux/settings/appearance` persists three display preferences to `localStorage["ux.prefs"]` — table `density`, `reduceMotion`, `relativeTime` — but no component consumes them, so the toggles are disabled behind `flags.displayPrefs`. Client-side only: make the prefs actually drive rendering app-wide, remove the flag, mark G20 resolved. No backend, no new UX surface.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Density preference changes list/table density (Priority: P1)

A user who prefers tighter information density sets "Table density" to **compact** on `/ux/settings/appearance` and sees list tables render denser rows across the app (components, products, teams, credentials, agents, runs, suggestions — wherever the shared table pattern applies). Switching back to **comfortable** restores the default spacing. The choice persists across reloads on this device.

**Why this priority**: Density is the headline pref — the visible, high-frequency payoff of the settings page; without it the page is dead state.

**Independent Test**: set `ux.prefs.density = "compact"` → tables/lists render the compact variant; `"comfortable"` (or unset) renders today's spacing; reload preserves it.

**Acceptance Scenarios**:

1. **Given** `density: "compact"` persisted, **When** a list table renders, **Then** its rows use the reduced padding/density treatment.
2. **Given** no pref stored (or `"comfortable"`), **When** any surface renders, **Then** the layout is pixel-identical to today — comfortable is the default, not a new variant.
3. **Given** the toggle changed on the settings page, **When** navigating to a list without reload, **Then** the new density applies (live, not only on full reload).

### User Story 2 - Relative-time preference toggles timestamp display (Priority: P1)

A user who prefers absolute timestamps turns off "Relative times" on `/ux/settings/appearance` and sees every `RelativeTime` rendering (activity feed, attention rows, last-seen columns, session times, run times) switch to the absolute `formatDateTime` form. Turning it back on restores relative labels.

**Why this priority**: `RelativeTime` is a single shared primitive — wiring the pref into it is one seam that flips the whole app; it's also the pref users are most likely to notice day to day.

**Independent Test**: set `ux.prefs.relativeTime = false` → timestamp surfaces render `formatDateTime`; unset/`true` renders the existing relative label.

**Acceptance Scenarios**:

1. **Given** `relativeTime: false`, **When** a surface using `RelativeTime` renders, **Then** it shows the absolute datetime (same `formatDateTime` output the rest of the app uses).
2. **Given** `relativeTime` unset or `true`, **When** the same surface renders, **Then** it shows the relative label exactly as today.
3. **Given** the toggle flips on the settings page, **When** the user navigates without reload, **Then** timestamps update live.

### User Story 3 - Reduce-motion preference suppresses transitions/animations (Priority: P2)

A motion-sensitive user enables "Reduce motion" and sees decorative transitions/animations suppressed across the app (hover transitions, opacity/slide animations, spinner/skeleton pulses) — matching the behavior `prefers-reduced-motion` users get via the media query.

**Why this priority**: An accessibility-leaning nicety; most surfaces' transitions are subtle, so the payoff is real but smaller than the first two.

**Independent Test**: set `ux.prefs.reduceMotion = true` → an app-wide attribute/class suppresses transition/animation CSS; `false`/unset leaves today's behavior untouched.

**Acceptance Scenarios**:

1. **Given** `reduceMotion: true`, **When** the app shell mounts, **Then** a root-level signal (attribute or class) is present that the stylesheet can target.
2. **Given** the signal present, **When** animated surfaces render (hover states, skeleton pulses, transitions), **Then** their motion is suppressed per the stylesheet rule.
3. **Given** the toggle flips, **When** the user navigates without reload, **Then** motion behavior updates live.

---

### Edge Cases

- Corrupt or non-JSON `ux.prefs` in localStorage → treated as empty (all defaults), never a crash — the existing `loadPrefs` try/catch already guarantees this; consumers must not re-parse and break it.
- Unknown `density` values → fall back to comfortable.
- The prefs are **per-device localStorage** — no backend persistence, no cross-device sync (explicit non-goal; matches the existing page).
- SSR/first-paint: prefs read after mount (existing `mounted` gate on the settings page) — consumers must not cause hydration flicker or read localStorage during render in a way that breaks under the Vite SPA; a small `useUxPrefs` hook reading on mount is the expected seam.
- `prefers-reduced-motion` OS setting still applies independently — the pref and the media query both suppress motion; the pref never *enables* motion the OS already suppressed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A shared preference seam (hook/context or equivalent) MUST read `localStorage["ux.prefs"]` once, expose `{density, reduceMotion, relativeTime}` with defaults `{comfortable, false, true}`, handle corrupt/unknown values safely, and re-render consumers on change without a page reload.
- **FR-002**: `density: "compact"` MUST switch shared list/table surfaces to the compact density variant; `comfortable`/unset/unknown MUST render today's spacing unchanged.
- **FR-003**: `relativeTime: false` MUST make the shared `RelativeTime` primitive render the absolute `formatDateTime` form; `true`/unset renders the current relative label.
- **FR-004**: `reduceMotion: true` MUST set a root-level signal (attribute or class) the stylesheet uses to suppress transitions/animations app-wide; `false`/unset removes it.
- **FR-005**: The three controls on `/ux/settings/appearance` MUST be enabled and their flag-off copy/gates removed; `displayPrefs` MUST be deleted from `ux/lib/flags.ts` (resolved flag precedent: `profileSelfEdit` in spec 038, the four flags in spec 040).
- **FR-006**: G20 MUST be marked RESOLVED in `researches/ux-rewrite-gaps.md` (spec 041, flag removed) per `docs/ux.md` §7; `docs/roadmap.md` records 041 under Shipped.

### Key Entities

- **`ux.prefs` (localStorage)**: `{density?: string, reduceMotion?: boolean, relativeTime?: boolean}` — persisted by `appearance.tsx`'s `setPref`; the contract consumers read.
- **`RelativeTime` primitive** (`ux/components/patterns/primitives.tsx`): the single timestamp seam all surfaces share.
- **Root element signal**: attribute/class applied at the app shell so density/motion rules cascade.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All three settings-page toggles are enabled and every change is visible in-app without reload — zero dead controls.
- **SC-002**: With defaults (no stored prefs), the rendered app is identical to today — the feature is strictly opt-in.
- **SC-003**: `RelativeTime` honors the pref in 100% of usages (single seam, verified by rendering one relative-time surface with the pref off).
- **SC-004**: `displayPrefs` is removed from `flags.ts` with zero remaining consumers; G20 marked resolved; frontend suite stays green.

## Assumptions

- The v0 prototype defines compact density as reduced row padding on the shared table/list components — the minimal honest consumption; global font-size or spacing-scale overhauls are out of scope.
- A single shared seam (e.g. a `useUxPrefs` hook + a root attribute) is the intended mechanism; exact choice resolved at plan time.
- Reduce-motion targets decorative motion (transitions, keyframe animations, skeleton pulse) via a stylesheet rule on the root signal — no per-component prop threading.
- No backend persistence — per-device localStorage only (the page already works this way; CONTEXT/constitution never promised sync).
