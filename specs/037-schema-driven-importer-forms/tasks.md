# Tasks: Schema-Driven Importer Forms

**Input**: spec.md, plan.md, research.md, data-model.md,
contracts/scope-fields.md from `specs/037-schema-driven-importer-forms/`

## Phase 1 — Foundational: scope-schema mapper (blocks all stories)

- [x] T001 [P] Failing tests `packages/frontend/src/test/unit/scope-schema.test.ts` — every mapping row from `contracts/scope-fields.md` (string→text, format:uri→url, boolean→boolean, enum→enum (+options), number/integer→number, `array` of `{type:"string"}`→string-list, object/record/non-string-array→json); `required[]` membership → `required:true`; `default` extracted; `fieldsForSchema` preserves property order; `fieldsForSchema` returns `[]` on missing/non-object/empty `properties`; `defaultsFor` materializes defaults + `""` for required-without-default; `unknownKeys(stored, schema)` splits stored keys ∉ `properties`; `scopeFromValues` produces the exact `Record<string,unknown>` the JSON editor produced
- [x] T002 Implement `packages/frontend/src/ux/components/importers/scope-schema.ts` — pure functions `fieldsForSchema`, `defaultsFor`, `scopeFromValues`, `unknownKeys`, `ScopeField` type per data-model.md; humanized labels (`includeForks`→"Include forks")

## Phase 2 — US1: typed scope controls (P1)

- [x] T003 [US1] Failing tests in `packages/frontend/src/test/unit/importer-form-scope.test.tsx` — rewrite the JSON-textarea suite for typed mode: GitHub manifest renders `org` input marked required, `baseUrl` url input, `repos` list editor, `billingPeriod` select, `include*` switches at schema defaults, `environmentMapping` per-field JSON block; empty required submit shows inline field error and does not call mutate; filled form submits `scope` containing entered values + materialized defaults; edit mode pre-populates from stored scope (not defaults); web-url manifest renders a single url field
- [x] T004 [US1] Implement `packages/frontend/src/ux/components/importers/scope-fields.tsx` — `ScopeFields` renders `ScopeField[]` with existing `Field`/`FieldLabel`/`FieldDescription`/`FieldError`/`Input`/`Select`/`Switch`/`Textarea` primitives; required marker; string-list row add/remove; per-field JSON `Textarea` for `kind:"json"`
- [x] T005 [US1] Rewire `packages/frontend/src/ux/components/importers/importer-form.tsx` — `scopeValues` state seeded via `defaultsFor`; Scope section renders `ScopeFields`; submit builds `scopeFromValues(fields, scopeValues)` and passes it through unchanged (no envelope); update the section description to drop "Edited as JSON until field-level controls land"
- [x] T006 [US1] Server error mapping in `importer-form.tsx` — `fieldErrors(err)` keys starting `scope.` re-split to the matching scope field error; bare `scope` stays the section-level error

## Phase 3 — US2: fallbacks (P2)

- [x] T007 [US2] Failing tests — `environmentMapping` renders a labeled JSON sub-editor while siblings stay typed and a valid mapping lands in submitted scope; "Edit as JSON" toggle shows the serialized scope, edits survive toggling back to typed; invalid JSON in a sub-editor or raw mode blocks submit with an inline error naming the field; unrecognized-fields block renders stored keys ∉ schema and preserves them on save
- [x] T008 [US2] Implement in `scope-fields.tsx`/`importer-form.tsx` — scope-level "Edit as JSON" toggle (`rawMode`/`rawText`, serialize on toggle-to-raw, parse-on-toggle-back with inline error on failure); "Unrecognized fields" labeled JSON sub-editor seeded from `unknownKeys`, merged into submitted scope unless emptied

## Phase 4 — US3: no silent scope loss (P3)

- [x] T009 [US3] Failing test — create mode: enter `org` on GitHub, switch to Kubernetes → `org` gone, Kubernetes defaults render; rerender with a new manifests array identity mid-edit → entered values preserved
- [x] T010 [US3] Implement importer-switch reset in `importer-form.tsx` — on importer change (create mode) rebuild `scopeValues` from `defaultsFor(new schema)` only; manifests through a ref so refetches can't wipe values (same guard pattern as shipped form)

## Phase 5 — Ship

- [x] T011 Add `.changeset/schema-driven-importer-forms-037.md` (`@componode/frontend` minor — new user-facing capability)
- [x] T012 Mark G13 resolved in `researches/ux-rewrite-gaps.md` (incl. the spec-queue line for `037`); add `037-schema-driven-importer-forms` to `docs/roadmap.md` shipped list + revise the Next entry (UX-rewrite gap program closes)
- [x] T013 `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green; PR to `main` — merge only on user approval

## Dependencies

Phase 1 blocks 2–4. Phases 2–4 are sequential edits to the same two
files — run in order. Phase 5 runs once, when the batch is approved.

## Independent test criteria

- **US1**: create a config for each of the 8 importers using only typed
  controls; saved scope round-trips server validation.
- **US2**: GitHub `environmentMapping` edits via its JSON block land in
  scope; raw toggle round-trips losslessly.
- **US3**: GitHub→Kubernetes switch leaks zero keys; manifest refetch
  preserves edits.

**MVP**: Phases 1–2 (US1) alone deliver the core value; US2/US3 are
correctness hardening that must ship in the same PR.

## Phase 6: Convergence

- [x] T014 Unit test per FR-009 (partial): mocked `useUpdateImporterConfig` failing with `VALIDATION_FAILED` `details[]` carrying scope paths — `["scope","repos"]` and bare `["org"]` — attaches errors to the matching scope fields; `unrecognized_keys` issues attach to the Unrecognized-fields block
- [x] T015 Reject non-object JSON in `kind:"json"` scope fields per contracts/scope-fields.md (partial): `setJsonFieldText` reports `${label} must be a valid JSON object.` when the parsed value is a scalar or array instead of passing it through to submit
- [x] T016 Map unmatched server field errors to the Unrecognized block per FR-005a (partial): `applyServerErrors` attaches field errors whose key matches no scope field (e.g. `unrecognized_keys` names from strict schemas) to `scopeFieldErrors.__unknown` so strict-schema rejections surface where the keys live
