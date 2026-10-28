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

- [x] T011 F007 fix: `error-handler.ts` forwards `err.details`/`invalid-params` on coded VALIDATION_FAILED errors
- [x] T012 F007 regression test: `importers.test.ts` — invalid github scope returns populated `details[]` + `invalid-params[]`

- [x] T013 F008 fix: serialize  to JSON Schema on  routes; form shows required keys + prefills scope template
- [x] T014 F008 regression tests:  contains  (backend); form hint + template (frontend)

- [x] T015 F009 fix: scope reseeds on every importer change in create mode — no cross-importer leakage
- [x] T016 F009 regression test: importer switch GitHub -> Kubernetes yields {}

- [x] T017 F010 fix: rotate PATCH strips immutable  (strict update schema)
- [x] T018 F010 regression test: rotate payload carries , no 

- [x] T019 F011 audit: cross-checked every strict schema vs every frontend payload; fixed 3 id-leaks + resetToken->token + register floor
- [x] T020 F011 regression test: payload-key-leaks source-scan + resetToken mapping

- [x] T021 F012 fix: mapper passes componentGroupId/teamOwnerId/links; new component-edit-dialog + Edit button on detail page
- [x] T022 F012 regression test: prefill + schema-valid PATCH body

## Phase 2 — Ship (runs once, when the batch is approved)

- [x] T901 Add changeset(s) for every touched package (patch for fixes)
- [x] T902 Add `036-bugfix-ux-findings` to `docs/roadmap.md` shipped list + header bump
- [x] T903 `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green; mark draft PR ready for review — merge only on user approval

## Phase 3 — Review findings (code-review, round 1)

- [x] T023 CRITICAL (standards+spec): stale "8+ characters." FieldDescription in register.tsx:98 and security.tsx:58 — interpolate PASSWORD_MIN_LENGTH
- [x] T024 HIGH (standards): product-form.tsx sends raw YYYY-MM-DD sunsetAt vs datetime({offset:true}) — ISO-normalize; every product save with a sunset 400s
- [x] T025 HIGH (spec): importer-form reseed effect deps include manifests — a refetch wipes user-edited scope; key on importerName only (ref for manifests)
- [x] T026 MEDIUM (spec): lifecycle Select enabled on create — disable it (edit-only) so users can't pick RETIRED and silently get ACTIVE
- [x] T027 MEDIUM (spec): session-context redirects on any session-query failure — only Navigate when data===null (definitively unauthenticated); error case renders provider (AuthGuard decides)
- [x] T028 LOW (standards): lastActiveAt: null stub in session-context — check if view-type requires it; drop if optional
- [x] T029 NOTE (standards, judgement): err.details forwarding is inside ADR-071's documented {code,message,details?} surface — fields already existed; no ADR needed. NONE-sentinel/duplicate useComponentGroups baseline smells noted — deferred (not introduced by this batch)
