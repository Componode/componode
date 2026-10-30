# Implementation Plan: Schema-Driven Importer Forms

**Branch**: `037-schema-driven-importer-forms` | **Date**: 2026-10-30 | **Spec**: [spec.md](spec.md)

## Summary

Resolve ux-rewrite gap G13 — the last UX-rewrite backend gap. The
importer create/edit form's Scope section renders typed, per-field
controls generated from the manifest's `configSchema` JSON Schema
(already serialized server-side by spec 036, zod v4 `z.toJSONSchema`
draft-2020-12 output) instead of a raw JSON textarea. Frontend-only
change: a pure `schema → field-descriptor` mapper plus a `ScopeFields`
renderer component handle string/URL/enum/boolean/number/string-array
properties; anything else (objects, records, nested shapes) degrades to
a labeled per-field JSON sub-editor, and a scope-level "Edit as JSON"
mode round-trips losslessly for power users. Stored keys absent from the
schema render in an "unrecognized fields" JSON block and survive save
unless removed (clarified). Schema defaults pre-fill and are submitted
explicitly (clarified). Flagless — the capability exists; the JSON
editor remains the defined fallback. No endpoint, schema, or manifest
contract change: no ADR amendment, no `openapi.yaml` diff; gap registry
entry G13 is marked resolved and the roadmap updated.

## Technical Context

**Language/Version**: TypeScript 6, React 18. **Dependencies**: existing —
TanStack Query, shadcn/ui field primitives (`Field`, `Input`, `Select`,
`Switch`, `Textarea`), zod v4 (schema shape only — no client-side zod).
**Storage**: N/A (no persistence change). **Testing**: vitest +
testing-library (`packages/frontend/src/test/unit/`). **Constraints**:
client validation is a convenience — server zod stays authoritative
(spec Assumptions); submitted scope shape byte-identical to the JSON
editor's output (FR-008); importer packages untouched (constitution II);
GETs unchanged/side-effect-free (ADR-094); UX gap governance —
`researches/ux-rewrite-gaps.md` G13 resolved in the same change.

## Decisions (research)

- **D1 Contract consumed**: `ImporterManifest.configSchema` arrives as
  JSON Schema (draft 2020-12 via `z.toJSONSchema`): object schemas carry
  `properties` + `required[]` + per-property `default`; `.strict()`
  surfaces as `additionalProperties: false`; `superRefine` URL checks do
  not serialize — URL fields arrive as `{type:"string", format:"uri"}`.
  Only **top-level** properties get controls (spec scope boundary).
  *Ratified in:* existing behavior — spec 036, no ADR touch.
- **D2 Pure mapper + renderer split**: `scope-schema.ts` exports pure
  functions — `fieldsForSchema(schema) → ScopeField[]`,
  `defaultsFor(schema) → Record`, `scopeFromValues(fields, values,
  unknown) → Record`, `unknownKeys(scope, schema) → Record` — fully
  unit-testable without DOM. `scope-fields.tsx` renders descriptors with
  existing shadcn primitives. Mirrors the repo's mapper-rule convention
  (`docs/ux.md` §5).
- **D3 Field mapping** (contract detail in `contracts/scope-fields.md`):
  `string`→text `Input`; `format:"uri"`→`Input type="url"`;
  `boolean`→`Switch`; `enum`→`Select`; `number`/`integer`→`Input
  type="number"`; `array` of `string`→list editor (row add/remove);
  everything else→per-field JSON `Textarea`. `required` → `*` marker +
  empty-submit block; `default` → initial value.
- **D4 State model**: `scopeValues: Record<string, unknown>` is the typed
  source of truth; `rawMode: boolean` toggles to a `Textarea` bound to
  `JSON.stringify(scope, null, 2)`. Toggle→raw serializes current values;
  toggle→typed parses the raw text (parse error keeps raw mode open with
  an inline error). Submit in either mode produces the same
  `Record<string, unknown>` — no envelope (FR-008).
- **D5 Defaults materialization**: `defaultsFor` seeds every property
  that declares `default` (plus `""` for required-without-default) into
  `scopeValues` on create; submitted scope therefore contains displayed
  defaults explicitly — clarified Q1. On edit, stored scope wins; fields
  missing from storage get their schema default.
- **D6 Unknown keys**: `unknownKeys` computes `stored −
  schema.properties`; when non-empty the typed view renders a labeled
  "Unrecognized fields" JSON sub-editor seeded with those keys —
  preserved on save, removable by the operator (clarified Q2).
- **D7 Importer switch / refetch**: switching importers in create mode
  rebuilds `scopeValues` from the new schema's defaults only — zero key
  leakage (spec 036 behavior preserved). Manifests pass through a ref so
  a refetch identity-change can't wipe entered values — same guard as
  the shipped form.
- **D8 Server error mapping**: `fieldErrors()` already maps zod
  `details[].path` → `"scope.<key>"`; the form re-splits that prefix to
  attach errors to the matching scope field, falling back to the
  scope-level error. No api-client change.
- **D9 Registry/docs**: `researches/ux-rewrite-gaps.md` G13 → resolved;
  `docs/roadmap.md` shipped entry + Next revision (program closes —
  remaining items are all deferred). Importer setup guides: config
  fields/secrets unchanged → no `docs/importers/*.md` edits (verified at
  ship). `docs/openapi.yaml`: no endpoint change → no regeneration.
- **D10 No flag**: gap entry states the JSON editor is the shipped state
  with no flag; typed controls are the resolution, not a fallback — per
  UX governance no flag is added (spec FR-010).

## Constitution Check

I single-org ✓ · II importer-first ✓ (no importer package touched;
manifest contract unchanged) · III taxonomy ✓ · IV env-as-instance ✓ ·
V factual layer ✓ (scope is declared config, human-authored) · VI
test-first ✓ (failing mapper + component tests before implementation) ·
VII observability ✓ (no new runtime paths — form-only). No violations —
re-checked post-design, unchanged.

## Source touch-points

```text
packages/frontend/src/ux/components/importers/scope-schema.ts   # NEW pure mapper
packages/frontend/src/ux/components/importers/scope-fields.tsx  # NEW renderer
packages/frontend/src/ux/components/importers/importer-form.tsx # Scope section rewired
packages/frontend/src/test/unit/scope-schema.test.ts            # NEW mapper tests
packages/frontend/src/test/unit/importer-form-scope.test.tsx    # updated — typed controls
researches/ux-rewrite-gaps.md                                   # G13 → resolved
docs/roadmap.md                                                # shipped + Next
```
