# Bugfix batch: UX findings from live iteration

> Accumulating spec — user-reported bugs and findings land here as `F###`
> entries. Each finding gets: root cause, regression test first, minimal fix,
> task row in `tasks.md`. One branch (`bugfix/036-ux-findings`), one PR, merged
> only when the user approves. Precedent for mechanics: `035-bugfix-user-form-validation`.

## Findings

### F001 — Expired session → blank page instead of login

- **Reported**: initial page hangs blank; `/auth/session` returns 401
  `AUTH_NO_SESSION` "Session expired" and nothing renders.
- **Surface**: `UxShell` session gate (all authenticated routes).
- **Root cause**: `ux/components/app/session-context.tsx` —
  `SessionProvider` does `if (!value) return null`. `useSession()`
  (`api/hooks/auth`) deliberately resolves `null` on `AUTH_NO_SESSION`, so the
  provider unmounts the whole subtree — `Outlet` → `AuthGuard` → its
  `<Navigate to="/login">` never mounts. Blank page, no redirect.
- **Fix**: provider resolves three states — pending → shell spinner;
  resolved-null → `<Navigate to="/login" replace>`; session → render children.
- **Regression test**: `session-context.test.tsx` — null session redirects to
  `/login`; pending renders a loading state; session renders children.

### F002 — Checked colors never apply on radio / switch / checkbox

- **Reported**: role radio buttons in user creation show wrong colors in both
  light and dark mode; same "weird pattern" asked to be swept everywhere.
- **Surface**: `ux/components/ui/{radio-group,switch,checkbox}.tsx` (+ any
  `data-checked:`/`data-unchecked:`/`data-on:`/`data-off:` class anywhere).
- **Root cause**: Radix primitives emit `data-state="checked"|"unchecked"`;
  the shadcn port uses `data-checked:`/`data-unchecked:` variants which match
  a `[data-checked]` attribute that never exists → checked styles
  (`border-primary`, `bg-primary`, `text-primary-foreground`) never apply.
  Untouched-state classes like `not-data-checked:border-input` also never
  apply. Confirmed on installed `@radix-ui/react-switch@1.4.1` dist: emits
  `data-state` only.
- **Fix**: replace bare data variants with `data-[state=checked]:`,
  `data-[state=unchecked]:`, `not-data-[state=checked]:` throughout.
- **Regression test**: source-scan of `ux/components/ui/*.tsx` forbidding the
  bare variants + DOM test asserting a checked `Switch`/`RadioGroupItem`
  carries `data-state="checked"` and the `data-[state=checked]` class.

### F003 — Password 12-char minimum invisible to users

- **Reported**: invite form demands 12 chars but "no ADR or place" says so;
  belongs in an ADR and/or security settings.
- **Surface**: `settings/security.tsx` change-password form; invite dialog
  (already fixed to `PASSWORD_MIN_LENGTH` in bugfix 035).
- **Root cause**: the minimum **is** ratified — ADR-099 ("12-character
  minimum is enforced on all password-setting paths"). The gap is UI: the
  security form still hints `minLength={8}` and no copy states the policy.
- **Fix**: `minLength={PASSWORD_MIN_LENGTH}` + "At least 12 characters"
  `FieldDescription` on the new-password field; policy line in the Security
  section description citing ADR-099. No ADR change needed — surface only.
- **Regression test**: security-page test asserting `minLength===12` on
  new-password and the policy text renders.

### F004 — "Allow self-registration" toggle appears dead

- **Reported**: toggle sends true/false to the API but the screen doesn't
  change; "awful" color matches the radio-button issue.
- **Surface**: `ux/app/settings/workspace.tsx` → `Switch`.
- **Root cause**: wiring is correct (`checked` bound,
  `onCheckedChange → useUpdateSettings` → `invalidateQueries(["settings"])`);
  the symptom is **F002** — `data-state` flips but `data-checked:` CSS never
  matches, so the control looks identical in both states. No separate code
  change; verified by F002's fix + test.
- **Regression test**: covered by F002's Switch DOM test.

## Acceptance criteria (batch)

- Every finding below has a failing regression test written before its fix.
- No contract-surface change without an ADR amendment (per AGENTS.md ADR
  fidelity); endpoint changes sync `docs/openapi.yaml` + `docs/api.md`.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green at ship.
- Changeset(s) added at ship time covering every touched package.
- Roadmap entry added on merge; gap registry touched only if a finding maps
  to a G-numbered gap.
