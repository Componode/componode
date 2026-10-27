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
  `SessionProvider` did `if (!value) return null`. `useSession()`
  (`api/hooks/auth`) deliberately resolves `null` on `AUTH_NO_SESSION`, so the
  provider unmounted the whole subtree — `Outlet` → `AuthGuard` → its
  `<Navigate to="/login">` never mounted. Blank page, no redirect.
- **Fix**: provider resolves three states — pending → shell spinner;
  resolved-null → `<Navigate to="/login" replace>`; session → render children.
- **Regression test**: `session-context.test.tsx` — null session redirects to
  `/login`; pending renders a loading state; session renders children.

### F002 — Checked colors never apply on radio / switch / checkbox

- **Reported**: role radio buttons in user creation show wrong colors in both
  light and dark mode; same "weird pattern" asked to be swept everywhere.
- **Surface**: `ux/components/ui/{radio-group,switch,checkbox,field}.tsx`.
- **Root cause**: Radix primitives emit `data-state="checked"|"unchecked"`;
  the shadcn port used `data-checked:`/`data-unchecked:` variants which match
  a `[data-checked]` attribute that never exists → checked styles
  (`border-primary`, `bg-primary`, `text-primary-foreground`) never applied.
  Confirmed on installed `@radix-ui/react-switch@1.4.1` dist: emits
  `data-state` only.
- **Fix**: replaced bare variants with `data-[state=…]:`,
  `not-data-[state=…]:`, `has-data-[state=…]:` throughout the ui/ components.
- **Regression test**: `control-state-attrs.test.tsx` — source-scan forbids
  bare variants; checked Switch/RadioGroupItem/Checkbox carry
  `data-state="checked"` + the `data-[state=checked]` class.

### F003 — Password 12-char minimum invisible to users

- **Reported**: invite form demands 12 chars but "no ADR or place" says so;
  belongs in an ADR and/or security settings.
- **Surface**: `settings/security.tsx` change-password form.
- **Root cause**: the minimum **is** ratified — ADR-099. The gap was UI:
  the security form still said "at least 8" and used `minLength={8}`.
- **Fix**: `minLength={PASSWORD_MIN_LENGTH}` + section description states
  the policy citing ADR-099. No ADR change needed — surface only.
- **Regression test**: `ux-settings-security.test.tsx` — `minLength===12`,
  policy copy renders.

### F004 — "Allow self-registration" toggle appears dead

- **Reported**: toggle sends true/false to the API but the screen doesn't
  change; "awful" color matches the radio-button issue.
- **Surface**: `ux/app/settings/workspace.tsx` → `Switch`.
- **Root cause**: wiring is correct (`checked` bound,
  `onCheckedChange → useUpdateSettings` → `invalidateQueries(["settings"])`);
  the symptom is **F002** — `data-state` flips but `data-checked:` CSS never
  matched. No separate code change; covered by F002.
- **Regression test**: covered by F002's Switch DOM test.

### F005 — "Add" forms leak previous record's values

- **Reported**: creating a new Line of Business shows a previous record's
  description (and other fields); reproduces across add/edit forms (LOBs,
  teams, products, ...).
- **Surface**: `ux/components/org/org-form-dialog.tsx` (shared LOB/Team
  create+edit dialog). Swept `ux/components/**` — no other instance found
  (invite-user/credential/importer dialogs use uncontrolled `FormData`
  inside Radix `DialogContent`, which unmounts on close; page-level forms
  mount fresh per route).
- **Root cause**: the reset effect ran only `if (open && initial)` —
  opening for *create* (`initial` undefined) kept the previous record's
  `useState` values; typed-but-unsaved values also persisted. The body read
  `initial.name` non-optionally (latent crash on create-open).
- **Fix**: reset unconditionally when `open` flips true — every field
  reverts to `initial ?? empty` (name/slug/description/lobId/slugTouched/
  error).
- **Regression test**: `org-form-dialog.test.tsx` — edit → close → create
  opens empty; unsaved typed values cleared on reopen.

### F006 — Product create 400s on `unrecognized_keys: lifecycle`, error unreadable

- **Reported**: creating a product returns 400 `Unrecognized key:
  "lifecycle"` shown as bare "Invalid input"; asks why lifecycle fails and
  for proper payload interpretation on all forms.
- **Surface**: `product-form.tsx` payload; `api/client.ts` `fieldErrors`.
- **Root cause**: `createProductSchema` is `.strict()` and deliberately has
  no `lifecycle` — lifecycle exists only on update schemas (a product is
  born ACTIVE; RETIRED is a mutation, per constitution IV). The form sent it
  unconditionally. `fieldErrors` also skipped `unrecognized_keys` issues
  (empty `path`; rejected names live in `keys[]`) → nothing mapped.
- **Fix**: create payload omits `lifecycle` (edit keeps it);
  `fieldErrors` maps each `keys[]` entry to the issue message so rejected
  fields bind correctly on every form.
- **Regression test**: `ux-authoring.test.tsx` asserts the create payload
  lacks `lifecycle`; `api-client.test.ts` asserts `keys[]`→field mapping
  from the reported payload.

## Acceptance criteria (batch)

- Every finding below has a failing regression test written before its fix.
- No contract-surface change without an ADR amendment (per AGENTS.md ADR
  fidelity); endpoint changes sync `docs/openapi.yaml` + `docs/api.md`.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green at ship.
- Changeset(s) added at ship time covering every touched package.
- Roadmap entry added on merge; gap registry touched only if a finding maps
  to a G-numbered gap.
