# Phase 1 — Data Model: App-Shell Chrome Bugfix

**Scope**: this bugfix touches no database schema, no API contract, and no
entity. The only persisted state is one browser-side key.

## Persisted UI state

| Store | Key | Values | Semantics |
|---|---|---|---|
| `sessionStorage` | `sidebar-collapsed` | `"true"` / `"false"` / *absent* | Explicit user collapse choice; **absent = "no preference" → width-based default** |

State transition (new with this fix):

```text
load
├── key absent  → collapsed = matchMedia("(max-width: 1023.98px)").matches
│                 (default: rail below lg, expanded at/above lg)
├── key "true"  → collapsed = true   (explicit choice wins)
└── key "false" → collapsed = false  (explicit choice wins)

toggle → write key → subsequent loads use the stored value
```

- The width-based default is evaluated **once** on mount; resizing never
  re-derives it and never writes the key.
- `sessionStorage` failure (private mode) degrades to the width-based
  default per load — same as today's behavior.

## Explicitly unchanged

- No DB migration, no CHECK constraint, no `docs/data-model.md` change.
- No API payload or query-param change.
- No new entities, relationships, or enums.
