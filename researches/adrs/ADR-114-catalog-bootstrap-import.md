### ADR-114 — Catalog bootstrap import: declarative product + dependency file

> **Status:** Ratified

**Context**: The DPAM review found cold start is the adoption gate: the
meaning layer starts empty while most organizations already keep an
application list somewhere (a spreadsheet, a CMDB export). APM practice is
explicitly spreadsheet-first (`dpam_landscape_research.md` §7). Componode
needs a one-shot way to stand up the product layer before the slower
suggestion/queue loop ([ADR-113](./ADR-113-staged-edge-suggestions.md))
refines it.

**Decision**:

1. **`POST /api/v1/products/bootstrap`** accepts a YAML document (YAML 1.2
   parses JSON for free) validated by a strict Zod schema:
   `{version: 1, products: [{name, type, description?, owner: {lob?, team?},
   tags?, criticality?, sunsetAt?, dependsOn: [ref]}]}`. Gated by the
   product-create permission; `?dryRun=true` returns the would-be report
   without writes. UI: an "Import products" card on the Products page.

2. **Two-phase semantics** — strict then best-effort:
   (a) whole-document validation: any malformed row fails the upload with
   per-row errors and nothing is written;
   (b) apply: products **upserted by slug** (existing slug → mutable fields
   updated, never deleted); every cross-entity ref resolves or lands in the
   report — `dependsOn` refs match component slug → name → `externalId`,
   owner refs match entity slug. Result shape:
   `{created, updated, edgesAdded, skipped: [{item, reason}]}`.
   **No implicit entity creation** — unresolved owners/components are
   reported, not fabricated.

3. **Scope**: Digital Products + `DEPENDS_ON` component edges only. No
   `COMPOSES`/`CONSUMES_FROM` in the file (product→product wiring in bulk
   needs ordering and cycle handling — deferred); no component creation —
   refs must point at discovered or manually created components.

4. **Not an importer**: this is a curated one-shot write path through the
   normal entity/edge services (audit per ADR-052), not a scheduled
   `DiscoveredAsset` source — constitution II untouched.

**Consequences**: route + Zod schema + service + Products-page UI;
`docs/openapi.yaml` + `docs/api.md` per ADR-104; lands in spec
`021-catalog-bootstrap` together with the "create product from components"
fast path and bulk `componentIds[]` wiring.

**Alternatives considered**: products-only CSV — rejected (still leaves all
wiring manual; CSV can't express edge lists cleanly). Full declarative
file including `COMPOSES` — deferred (ordering + cycle semantics in a bulk
apply are avoidable complexity for a bootstrap tool). Atomic
all-or-nothing apply — rejected (one typo in row 190 shouldn't void the
file).

## Amendments

- **2026-02**: The shipped UI entry point is an **"Import products" button**
  opening a dialog on the Products page (header action beside "New product",
  plus the empty-state action area), not the "Import products card" sketched
  in the original Decision text. The dialog provides the same flow: file →
  dry-run preview → apply → report.
