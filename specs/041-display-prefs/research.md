# Research: Display Preferences

Resolved by code inspection:

1. **Pref contract**: `ux.prefs` JSON `{density?:string, reduceMotion?:boolean, relativeTime?:boolean}`; `setPref` merges per-key. Defaults `{comfortable, false, true}` — `relativeTime` is opt-out (`!== false`).
2. **Live updates**: same-tab writes need a custom event (`window.dispatchEvent("ux:prefs")` from `savePref`); cross-tab uses `storage`. `useSyncExternalStore` gives re-render-on-change for free.
3. **App-wide signals**: `data-density`/`data-reduce-motion` on `document.documentElement` — cascades everywhere, no prop threading.
4. **Density**: `[data-density="compact"] th, td` padding override — attribute+element specificity beats the Tailwind cell utilities; only tables tighten (the page sells "Table density").
5. **Reduce motion**: `[data-reduce-motion] *` duration suppression — the standard user-pref pattern; media query stays independent (pref never un-suppresses OS-level motion).
6. **RelativeTime seam**: single primitive at `ux/components/patterns/primitives.tsx` — one hook read flips every timestamp.
7. **Flag removal**: `displayPrefs` is the page's only flag; delete the key (038/040 precedent) — no other consumers.
