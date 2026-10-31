# Tasks: Display Preferences

**Input**: Design documents from `/specs/041-display-prefs/`
**Tests**: Included — frontend unit tests (constitution VI).

## Phase 1: Prefs seam (US1+US2+US3 foundation)

- [x] T001 Create `packages/frontend/src/ux/lib/prefs.ts`: `PREFS_KEY`, `loadPrefs()` (corrupt-safe), `savePref()` (writes + dispatches `"ux:prefs"`), `useUxPrefs()` via `useSyncExternalStore` returning `{density, reduceMotion, relativeTime}` with defaults `{comfortable,false,true}` and safe coercion, `UxPrefsSync` component applying `data-density`/`data-reduce-motion` on `document.documentElement` in an effect
- [x] T002 Unit test: hook returns defaults with empty/corrupt storage; `savePref` round-trips and notifies listeners — `packages/frontend/src/test/unit/ux-prefs.test.ts`

## Phase 2: Consumers (US1/US2/US3)

- [x] T003 Mount `<UxPrefsSync/>` at the UX app root (find the shell in `ux/` — the router/layout entry)
- [x] T004 `RelativeTime` in `ux/components/patterns/primitives.tsx` consumes `useUxPrefs().relativeTime` — `false` renders `<time>{formatDateTime(iso)}</time>` (tooltip unchanged)
- [x] T005 `ux/styles.css`: `[data-density="compact"] th, [data-density="compact"] td` padding override + `[data-reduce-motion]` transition/animation suppression rule
- [x] T006 `app/settings/appearance.tsx`: use `useUxPrefs`/`savePref` from the shared module; enable all three controls; flag-off copy replaced; drop `flags` import
- [x] T007 Delete `displayPrefs` from `ux/lib/flags.ts`

## Phase 3: Tests + governance

- [x] T008 Tests: `RelativeTime` renders absolute when pref off; appearance page controls enabled and write prefs; `UxPrefsSync` sets/removes root attributes — `packages/frontend/src/test/unit/`
- [x] T009 Mark G20 RESOLVED (spec 041, flag removed) in `researches/ux-rewrite-gaps.md` — move entry out of the deferred list; update `docs/roadmap.md` (041 under Shipped)
- [x] T010 Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build`; commit, push, PR

## Phase 4: Review (code-review findings vs `main`)

- [x] T011 Update `docs/ux.md` — density line (~55) and the open-decisions list (~224) still describe G20 as unshipped (code-review: standards)
- [x] T012 Scope new CSS rules under `.ux-root` (file contract); drop the `.tabular` font-size override; shrink `th` height for compact (FR-002 — header rows stay h-10 today) (code-review: standards+spec)
- [x] T013 Make `getSnapshot` return the cached snapshot — re-read localStorage only inside the notify handler, not per render (FR-001 "read once") (code-review: spec)
- [x] T014 `useLayoutEffect` in `UxPrefsSync` so root attributes apply before first paint (hydration-flicker edge case) (code-review: spec)
- [x] T015 Inline `savePref` calls in appearance.tsx (Middle Man) and type it per-key `savePref<K extends keyof UxPrefs>(key: K, value: UxPrefs[K])` (code-review: standards)
- [x] T016 Move the struck G20 clause out of the deferred paragraph in ux-rewrite-gaps.md (T009 literal) (code-review: standards)
- [x] T017 Add an appearance-page test asserting the three controls are enabled and write prefs; drop the redundant `cleanup()` in ux-prefs.test.tsx (code-review: standards)

## Dependencies

- Phase 1 blocks all consumers; Phase 2 items parallel; Phase 3 last.
