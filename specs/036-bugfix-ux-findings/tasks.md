# Tasks: UX findings batch

## Phase 1 — Findings (appended as reported)

- [x] T001 F001 regression test: `session-context.test.tsx` — null session → `/login` redirect; pending → loading state; session → children
- [x] T002 F001 fix: `session-context.tsx` tri-state render (pending spinner / null→Navigate / session→Provider)
- [x] T003 F002 regression test: `control-state-attrs.test.tsx` — source-scan forbids bare `data-checked:`/`data-unchecked:`/`data-on:`/`data-off:` in `ux/components/ui`; checked Switch + RadioGroupItem carry `data-state="checked"` and matching `data-[state=checked]` classes
- [x] T004 F002 fix: `radio-group.tsx`, `switch.tsx`, `checkbox.tsx`, `field.tsx` — replace bare variants with `data-[state=…]` / `not-data-[state=…]` forms
- [x] T005 F003 fix: `settings/security.tsx` — `minLength={PASSWORD_MIN_LENGTH}` on new-password + "At least 12 characters" description + policy line citing ADR-099
- [x] T006 F004: verify F002 fix restores switch visuals; workspace wiring audited (no code change expected)

- [x] T007 F005 regression test: `org-form-dialog.test.tsx` — edit→create reopen is clean; unsaved values cleared
- [x] T008 F005 fix: `org-form-dialog.tsx` resets all fields unconditionally on open (`initial ?? empty`)
- [x] T009 F006 fix: `product-form.tsx` omits `lifecycle` on create; `fieldErrors` maps `unrecognized_keys.keys[]` to field names
- [x] T010 F006 regression test: create payload lacks `lifecycle` (ux-authoring); `unrecognized_keys` → `{lifecycle: msg}` (api-client)

## Phase 2 — Ship (runs once, when the batch is approved)

- [x] T901 Add changeset(s) for every touched package (patch for fixes)
- [x] T902 Add `036-bugfix-ux-findings` to `docs/roadmap.md` shipped list + header bump
- [x] T903 `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green; mark draft PR ready for review — merge only on user approval
