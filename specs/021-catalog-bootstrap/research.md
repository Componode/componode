# Research: Catalog Bootstrap

No NEEDS CLARIFICATION items remained after `speckit-clarify` — every open
decision below was resolved against ratified ADRs and existing code patterns.
Findings verified against `packages/backend/src` on 2026-10-18.

## D1 — Upload transport

**Decision**: `POST /api/v1/products/bootstrap` accepts the document as the
raw request body. Register a Fastify `addContentTypeParser` for
`application/yaml`, `application/x-yaml`, and `text/yaml` that returns the
raw string; `application/json` bodies arrive pre-parsed (YAML 1.2 subsumes
JSON, so both paths converge on the same object → Zod schema).

**Rationale**: "Accepts a YAML document" (ADR-114) is most honest as a
media-type-level upload — no JSON envelope wrapping a string. The frontend
`apiFetch` already supports overriding `Content-Type` via `options.headers`
and attaches the CSRF token automatically for POST.

**Alternatives considered**: `multipart/form-data` upload — rejected (no
multipart parser in the project; body is text, not a file stream; 1 MB
`bodyLimit` already bounds it). JSON envelope `{document: string}` —
rejected (forces escaping/YAML-in-string UX and gives JSON an odd privilege
over YAML for a file-shaped payload).

## D2 — Document schema location and strictness

**Decision**: `bootstrapDocumentSchema` lives in `packages/core/src/schemas`
(beside `product.ts`), strict objects at every level:
`{version: z.literal(1), products: bootstrapProductSchema[]}` where an item
is `{name, type, description?, owner: {lob?, team?}?, tags?, criticality?,
sunsetAt?, dependsOn?: string[]}` — `.strict()` everywhere (ADR-095). The
report types (`BootstrapReport`, `BootstrapSkippedItem`) are exported from
core so the frontend types the response without re-declaring it.

**Rationale**: contracts live in core by convention; strict objects give
"unknown field → whole-file rejection" for free via `ZodError` issues, whose
`path` already carries per-item addresses (`products.3.type`).

**Alternatives considered**: schema in backend only — rejected (frontend
needs the report types; core is the contract home).

## D3 — Apply pipeline shape

**Decision**: `catalog-bootstrap-service.ts#bootstrapCatalog(doc, {dryRun},
actor)`:

1. **Parse & validate** — YAML.parse (string) or pass-through (object) →
   `bootstrapDocumentSchema.safeParse` → failure: `400 VALIDATION_FAILED`
   with `details: issues`. Semantic check: duplicate derived slugs in one
   document → same 400 path.
2. **Batch-resolve** — collect all `owner.lob`/`owner.team`/`dependsOn` refs;
   resolve each namespace with single `IN (...)` queries:
   LOB by slug, Team by slug, components by `slug OR name OR externalId` then
   ordered-match per ref (slug → name → externalId; multi-match at the first
   matching stage → ambiguous → skipped). Load existing products by derived
   slug (any lifecycle) once.
3. **Per-item apply** — for each item, one `db.transaction()`:
   insert-or-merge-update (only present fields; `null`/`[]` clears; never
   `lifecycle`), reuse the `updateProduct` type-change guard
   (`TYPE_CHANGE_BLOCKED` → item lands in `skipped`), insert edges
   `onConflict doNothing`, `writeEntityChange` + `writeEdgeChange` per
   change (reason: `"catalog bootstrap import"`). A thrown error rolls back
   that item only and is reported in `skipped`; apply continues.
4. **Dry run** — identical pipeline with resolution/computation only: count
   would-be `created`/`updated`, would-be `edgesAdded` (resolved refs minus
   already-present edges), same `skipped` semantics, zero writes.

**Rationale**: per-item transactions implement the clarified per-item
atomicity; batched resolution keeps a 200-product file at O(1) queries
instead of O(items × refs); `onConflict doNothing` gives idempotent re-runs
for free and the insert count feeds `edgesAdded`.

**Alternatives considered**: single all-file transaction — rejected by
ADR-114 (one bad row shouldn't void the file). Calling `createProduct`/
`addDependsOnEdge` per item — rejected (each opens its own transaction;
couldn't compose under per-item atomicity, and ref-to-id resolution would be
per-item instead of batched). The service performs direct writes mirroring
`platform-promotion-service.ts` conventions.

## D4 — Fast path mechanism

**Decision**: extend `createProductSchema` with
`componentIds: z.array(z.string().uuid()).min(1).max(100).optional()`;
`createProduct` verifies every id exists (`404 NOT_FOUND` with
`details.missingIds`, same convention as the bulk edge path), then inserts
the product + all `DEPENDS_ON` edges + audit rows in its existing single
transaction.

**Rationale**: one atomic action is already what `createProduct` does; the
route, permission (`product:create`), and response shape are unchanged —
`componentIds` is just optional input. No new endpoint, no second round-trip
the UI could leave half-done.

**Alternatives considered**: create-then-wire from the UI via two calls —
rejected (non-atomic, leaves a product without edges on partial failure,
violates spec scenario 3). Separate endpoint — rejected (duplicates product
creation for no contract benefit).

## D5 — Dependency-picker multi-select

**Decision**: in `depends-on` mode the `EdgePicker` renders components as a
checkbox list submitting `{componentIds: [...]}` (one call) and groups as a
single-select submitting `{componentGroupId}`; selecting a group clears
component selection and vice-versa — preserving the exactly-one-of union.
`onAdd`'s body type widens to `Record<string, string | string[]>`.

**Rationale**: the backend union (`componentId` | `componentGroupId` |
`componentIds[]`) is already shipped and documented in openapi.yaml; only UI
reach is missing (research §2.1).

## D6 — Report `skipped` item identity

**Decision**: `skipped: [{item, reason}]` where `item` identifies what was
dropped: the product `name` for item-level failures, the raw ref string for
unresolved/ambiguous `dependsOn` and owner refs (prefixed by product name
for context: `"payments-shop → dependsOn 'paymets-db'"`-style readable
string). `reason` is a short machine-stable phrase (`not found`,
`ambiguous`, `type change blocked`, …).

**Rationale**: the ADR fixes the shape `{item, reason}`; keeping `item` a
plain string keeps the report renderable without a discriminated union while
still pinpointing the row.

## D7 — Type-change guard on upsert

**Decision**: upserts route `type` through the same guard `updateProduct`
uses — flipping a `PLATFORM` with `CONSUMES_FROM` consumers throws
`TYPE_CHANGE_BLOCKED`, which per-item atomicity converts into a `skipped`
entry for that product item.

**Rationale**: verified — `updateProduct` lines 490–513 enforce this today;
bootstrap must not bypass an invariant the interactive API enforces.

## Cross-cutting verifications

- `components.externalId` is indexed but **not unique**; `name` is not
  unique either — both can produce ambiguous matches → `skipped`, matching
  spec edge cases. `slug` is unique by convention (ADR-046); defensively,
  multi-match at any stage is still treated as ambiguous.
- `POST /products/bootstrap` vs. `GET /products/{slug}`: no route conflict
  (different methods); find-my-way resolves the static segment anyway.
- `yaml@^2.9.1` is already in `packages/backend/package.json` — no new
  dependency.
- `POST /products/:id/depends-on` already accepts `componentIds[]`
  (schema + service + openapi shipped with the ADR-110 amendment) —
  confirmed, remaining work is picker UI only.
- Existing `bodyLimit` is 1 MB — a 500-product YAML document is ~50–100 KB;
  comfortably in bounds (spec assumption stands, no code change).
