### ADR-111 — Practical catalog metadata: links, tags, criticality, sunset date

> **Status:** Ratified

**Context**: The catalog answers *what exists* and *what's wired to what*,
but lacks the everyday metadata practical catalogs live on: links to repos
and runbooks, free-form labels, a criticality signal, and a planned-retirement
date. The practical-DPAM grilling session ratified a minimal, all-optional
set — deliberately avoiding scorecards, mandatory fields, and lifecycle
machinery.

**Decision**:

1. **`links jsonb`** on `digital_products` and `components`: array of
   `{title, url}` — title required (≤80 chars), URL validated http/https via
   `safeUrl()` (ADR-085), ≤20 entries, order preserved. JSONB, not a join
   table — links are display-only; nobody filters by URL.

2. **`tags text[]`** on `digital_products` and `components`, GIN-indexed:
   lowercase `[a-z0-9][a-z0-9._:-]*`, ≤32 chars each, ≤20 per entity,
   deduplicated at write. A single-value `?tag=` filter lands on both list
   endpoints.

3. **`criticality`** on `digital_products` only: nullable enum
   `CRITICAL | HIGH | MEDIUM | LOW` — a core constant enforced by CHECK
   (ADR-079), plus `?criticality=` on the product list. Components inherit
   importance through the products that depend on them; no per-component
   criticality.

4. **`sunsetAt timestamptz`** nullable on **both** entities: a
   planned-retirement date with display semantics only — neutral badge >30
   days out, amber within 30 days, red "overdue" when past while `ACTIVE`.
   **Never auto-transitions** lifecycle; `ACTIVE`/`RETIRED` stays the
   two-state machine.

5. **All four fields are optional** in create/update — existing rows need no
   backfill; strict Zod schemas register each field (ADR-095); audit
   captures changes via the field-agnostic `writeEntityChange` (ADR-052).

**Consequences**: one additive migration on both tables; new core constant +
contract fields + schema/filter fields; create/edit forms, detail links
card, tag chips, criticality and sunset badges; `docs/openapi.yaml` updated
per ADR-104.

**Alternatives considered**: join tables for links/tags — rejected (CRUD and
read cost for display-only data; `details` already sets the JSONB
precedent). `TIER_1..TIER_4` criticality naming — rejected (needs a legend;
`CRITICAL/HIGH/MEDIUM/LOW` is self-describing). Automatic transition to
`RETIRED` at `sunsetAt` — rejected (surprising side effects; a date informs,
a person decides).
