# Implementation Plan: Display Preferences

**Branch**: `041-display-prefs` | **Date**: 2026-10-31 | **Spec**: [spec.md](./spec.md)

## Summary

Client-side only (G20): a shared `useUxPrefs` hook reads `localStorage["ux.prefs"]`
with safe defaults, notifies consumers live (custom same-tab event + `storage`
event), and applies `data-density`/`data-reduce-motion` attributes on
`document.documentElement`. `RelativeTime` consumes `relativeTime`; density and
reduce-motion cascade via CSS rules in `ux/styles.css`. The settings controls
are enabled and `displayPrefs` is deleted.

## Technical Context

**Language/Version**: TypeScript/React (frontend package only — no backend).
**Primary Dependencies**: none new — localStorage + DOM attributes + existing Tailwind/shadcn primitives.
**Testing**: frontend unit tests (hook, RelativeTime, appearance controls).
**Constraints**: defaults must render today's app identically; corrupt prefs safe; no hydration flicker (read on mount).

## Constitution Check

| Principle | Verdict |
|---|---|
| VI. Test-first | Pass — unit tests per consumer. |
| Gap governance (ux.md §7) | Pass — flag removed only when prefs are consumed; G20 marked resolved. |
| ADR-085 (no dangerouslySetInnerHTML) | Pass — attributes + CSS only. |

## Design (research.md)

1. **`ux/lib/prefs.ts`**: `loadPrefs()`/`savePref()` moved here from
   `appearance.tsx` + `useUxPrefs()` hook — `useSyncExternalStore` on a
   snapshot read + `ux:prefs`/`storage` listeners; returns
   `{density:"comfortable"|"compact", reduceMotion:boolean, relativeTime:boolean}`.
2. **Root signals**: `UxPrefsSync` component (mounted in the UX app root)
   sets `data-density`/`data-reduce-motion` on `document.documentElement`
   in an effect.
3. **Density CSS** (`ux/styles.css`): `[data-density="compact"] th/td`
   padding rule — attribute+element selector outranks the Tailwind cell
   classes without `!important` specificity hacks beyond the norm.
4. **Reduce-motion CSS**: `[data-reduce-motion] *, *::before/after`
   `animation-duration/transition-duration` suppression (`!important` —
   matches the media-query pattern; documented exception).
5. **RelativeTime**: `useUxPrefs().relativeTime === false` → render
   `<time>{formatDateTime(iso)}</time>` (tooltip still shows the same value).
6. **appearance.tsx**: use the shared hook; enable controls; flag-off copy
   gone; `displayPrefs` key deleted from `flags.ts`.

## Project Structure

```text
packages/frontend/src/ux/
├── lib/prefs.ts                      # NEW — loadPrefs/savePref/useUxPrefs + UxPrefsSync
├── lib/flags.ts                      # remove displayPrefs
├── components/patterns/primitives.tsx # RelativeTime consumes relativeTime pref
├── components/ux-app or app shell     # mount <UxPrefsSync/> (app root)
├── app/settings/appearance.tsx        # shared hook; controls enabled; copy updated
└── styles.css                         # compact-density + reduce-motion rules
packages/frontend/src/test/unit/       # prefs hook + RelativeTime + appearance tests
```
