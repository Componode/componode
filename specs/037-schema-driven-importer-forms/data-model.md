# Data Model: Schema-Driven Importer Forms

No persistence changes. The model is client-side: JSON Schema in, scope
`Record<string, unknown>` out.

## ScopeField (field descriptor)

Produced by `fieldsForSchema(configSchema)` — one per top-level
`properties` entry, in declaration order.

| Field | Type | Source |
|---|---|---|
| `key` | string | property name |
| `label` | string | humanized property name (`includeForks` → "Include forks") |
| `kind` | `text \| url \| boolean \| enum \| number \| string-list \| json` | mapping table in contracts/scope-fields.md |
| `required` | boolean | property ∈ schema `required[]` |
| `options` | string[] | `enum` values (`kind: enum` only) |
| `default` | unknown | schema `default` when declared |
| `description` | string \| undefined | schema `description` when present (none today) |

Anything not matching a dedicated `kind` (object/record/nested) maps to
`kind: "json"` — the per-field fallback.

## Form state

| State | Type | Notes |
|---|---|---|
| `scopeValues` | `Record<string, unknown>` | typed-mode source of truth |
| `rawMode` | boolean | raw-JSON view of the same scope |
| `rawText` | string | JSON-mode buffer; parse errors block toggle-back + submit |
| `unknownScope` | `Record<string, unknown>` | stored keys absent from schema — "unrecognized fields" block |
| `fieldErrors` | `Record<string, string>` | client + mapped server errors keyed by scope key |

## Submitted payload

`scope = scopeFromValues(fields, scopeValues) ∪ unknownScope` — the
exact `Record<string, unknown>` shape the old JSON editor produced.
Defaults are materialized in `scopeValues` at seed time, so untouched
defaults submit explicitly (clarified Q1).
