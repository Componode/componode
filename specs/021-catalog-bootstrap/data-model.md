# Data Model: Catalog Bootstrap

**No schema migration.** Every write lands on existing tables
(`digital_products`, `product_depends_on_component`); the bootstrap document
and report are transient — validated, applied, returned, discarded.

## Bootstrap document (transient input contract)

`bootstrapDocumentSchema` — `packages/core` — strict at every level:

```yaml
version: 1                      # required literal; any other value rejects the file
products:                       # required array (may be empty)
  - name: string                # required, 1–200 chars; slug derived via toSlug(name)
    type: PRODUCT_TYPE          # required enum (BUSINESS_CAPABILITY | CUSTOMER_FACING | PLATFORM)
    description: string|null    # optional
    owner:                      # optional object, strict
      lob: string|null          # optional — LineOfBusiness slug; null clears
      team: string|null         # optional — Team slug; null clears
    tags: string[]              # optional — tagSchema rules (≤20, charset/length)
    criticality: CRITICALITY    # optional enum | explicit null
    sunsetAt: iso8601|null      # optional datetime-with-offset | explicit null
    dependsOn: string[]         # optional — component refs
```

Validation rules (whole-document phase — any failure = `400
VALIDATION_FAILED`, zero writes):

- Unknown fields anywhere, `version !== 1`, non-array `products`, malformed
  items (bad enum, overlong strings, `dependsOn` entries that aren't
  strings).
- Two items deriving the same slug — duplicate-slug semantic check after
  schema parse.

## Upsert field mapping (apply phase, per item)

Key: `slug = toSlug(name)` — matches an existing `digital_products` row of
**any** lifecycle.

| File field | `digital_products` column | On update (merge semantics) |
|---|---|---|
| `name` | `name` | applied when present (always present) |
| `type` | `type` | applied when present; `TYPE_CHANGE_BLOCKED` guard applies |
| `description` | `description` | applied when present; `null` clears |
| `owner.lob` | `lobOwnerId` | resolved slug → id; omitted key leaves column; explicit `null` clears |
| `owner.team` | `teamOwnerId` | same |
| `tags` | `tags` | applied when present; `[]` clears |
| `criticality` | `criticality` | applied when present; `null` clears |
| `sunsetAt` | `sunsetAt` | applied when present; `null` clears |
| — (never) | `lifecycle`, `slug`, `links`, `id`, timestamps/actor cols | file cannot express them; `links` untouched on update |

`owner` sub-keys accept `null` to clear (`owner: {lob: null}` clears
`lobOwnerId`); an omitted sub-key leaves the column untouched —
merge semantics apply recursively (spec Clarifications Q1).

## Ref resolution (apply phase)

| Ref kind | Resolution order | Failure mode |
|---|---|---|
| `owner.lob` | `line_of_businesses.slug = ref` | 0 matches → `skipped`; >1 → `skipped` (ambiguous) |
| `owner.team` | `teams.slug = ref` | same |
| `dependsOn[]` item | `components.slug = ref` → `components.name = ref` → `components.externalId = ref` | 0 matches at all stages → `skipped` (not found); >1 at first matching stage → `skipped` (ambiguous) |

- Resolution is not lifecycle-filtered (`RETIRED` components resolve and
  wire — consistent with the existing edge API).
- All refs are batch-resolved in O(1) `IN` queries before any write.
- `dependsOn` resolves to concrete `components` only — `component_groups`
  are never matched (group edges stay manual per ADR-114 scope).

## Import report (transient output contract)

```json
{
  "created": 3,
  "updated": 1,
  "edgesAdded": 7,
  "skipped": [
    { "item": "payments-shop → dependsOn \"paymets-db\"", "reason": "component not found" },
    { "item": "billing", "reason": "type change blocked by existing CONSUMES_FROM edges" }
  ]
}
```

- `created`/`updated` count product items (a `RETIRED` product matched by
  slug counts as `updated`, stays `RETIRED`). An item whose merge produces
  **zero field changes** writes nothing — no update, no audit row — and is
  counted as neither `created` nor `updated`; a byte-identical re-import
  therefore reports `created: 0, updated: 0, edgesAdded: 0`.
- `edgesAdded` counts `DEPENDS_ON` edges actually inserted (existing edges
  are skipped silently — idempotent re-runs report `0` for everything).
- `skipped[].item` is a readable identifier (product name, or product +
  ref); `reason` is a short stable phrase.
- `?dryRun=true` returns the identical shape describing *would-be* effects,
  computed against live data with zero writes.

## Audit trail (existing tables, ADR-052)

Per applied item: `writeEntityChange` (`digital_product` `created`/`updated`)
+ one `writeEdgeChange` (`DEPENDS_ON_COMPONENT` `added`, to `component`) per
wired edge — all carrying the acting user's `Actor` and reason `"catalog
bootstrap import"`. Fast-path creates and bulk-picker adds reuse the same
helpers; dry run writes nothing.

## Existing entities referenced (unchanged)

`DigitalProduct`, `Component`, `ComponentGroup` (not a file target),
`LineOfBusiness`, `Team`, `product_depends_on_component` junction —
definitions unchanged; see `specs/005`/`017`/`019` data models for their
fields.
