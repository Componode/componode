# Contract: BOM Curation + Contract Deltas (Phase 2)

**Date**: 2026-11-21 | **Spec**: [spec.md](../spec.md) | **Data model**: [data-model.md](../data-model.md)

All routes live under `/api/v1`, session-gated. Reads are `verifySession` (any role) and side-effect-free (ADR-094/097); writes require `component:edge:add` (EDITOR, new RBAC action) and declare `x-permission` (ADR-104). Bodies are Zod `.strict()` (ADR-095); errors use `{code,message,details?}` (ADR-071/096). Everything below lands in `docs/openapi.yaml` in the same change.

## `GET /packages/add-to-catalog/preview`

Derived preview for the Add/Link dialog — the dialog renders this verbatim (D11).

### Query

| Param | Type | Behaviour |
|---|---|---|
| `purl` | string, required | verbatim or normalized purl; normalized via `normalizePurlIdentity` (unparseable → verbatim identity) |

### Response `200`

```json
{
  "name": "lodash",
  "identity": "pkg:npm/lodash",
  "category": "LIBRARY",
  "provider": "NPM",
  "providerGroup": "package-registries",
  "resourceType": "npm:package",
  "consumerCount": 14,
  "versions": [{ "version": "4.17.21", "componentCount": 9 }],
  "mappedFrom": null,
  "existingComponent": null
}
```

- `consumerCount` = distinct ACTIVE components whose `bom_entries.purlIdentity` equals the identity (0 → create-only).
- `existingComponent` `{id,slug,name,category,provider}` when any component's `externalId` normalizes to the identity → the dialog is in **Link mode**.
- `mappedFrom` `{cdxType, note}` non-null on lossy inference (non-`library`/`framework` cdxType, unmapped ecosystem→`OTHER`, registry-derived provider ambiguity).
- `404` when no `bom_entries` row carries the identity (nothing to add).

## `POST /packages/add-to-catalog`

Create one Library component; optionally link all consumers. **Atomic.**

```json
// body
{ "purl": "pkg:npm/lodash@4.17.21", "linkConsumers": true }
// 200
{ "component": { "id": "…", "slug": "pkg-npm-lodash", "name": "lodash", "category": "LIBRARY", "provider": "NPM", "externalId": "pkg:npm/lodash" },
  "linked": 9, "alreadyLinked": 1, "suggestionsStaged": 0 }
```

- `linkConsumers: true` → `INSERT component_depends_on_component (consumer, library)` per distinct ACTIVE consumer, `ON CONFLICT DO NOTHING`; `linked` = created, `alreadyLinked` = pre-existing (edges preserved). Covered PENDING suggestions → `ACCEPTED`; pairs already edged → `SUPERSEDED`.
- `linkConsumers: false` → stage `PURL_EXACT` suggestions per consumer; `suggestionsStaged` populated.
- Sets `resolvedComponentId` on every `bom_entries` row of the identity either way.
- `409 CONFLICT` when a component already owns the identity → client must call `/packages/link` instead (response includes `existingComponent`).

## `POST /packages/link`

Link an existing component to a package identity; same consumer semantics.

```json
// body
{ "purl": "pkg:npm/lodash", "componentId": "uuid", "linkConsumers": true }
// 200 → same { component, linked, alreadyLinked, suggestionsStaged } shape
```

- `404` unknown `componentId`; `409` if `componentId` resolves to a RETIRED component.
- Sets `resolvedComponentId` on all rows of the identity to `componentId` — a deliberate re-point when a different component is chosen.

## `GET /packages/versions`

All versions for one identity (Library detail "Versions in use" — `/packages` top-5 truncates).

| Param | Behaviour |
|---|---|
| `purl` | required; normalized like consumers |
| `page`,`pageSize` | optional — returns full set when under one page |

`200 { data: [{ "version": "4.17.21", "componentCount": 9 }], pagination }` sorted `componentCount desc, version asc`.

## Deltas to shipped contracts

### `GET /packages` (spec 074 — fields go live)

- `catalogComponent` — `{id,slug,name}` of the component the row's BOM entries resolved to (`resolvedComponentId`, written by the match pass or an Add/Link decision — the canonical normalized-identity match), falling back to a non-retired component whose `externalId` equals the row's normalized `purl` verbatim, else `null`.
- `pendingSuggestionCount` — count of distinct PENDING `bom_component_suggestions` with `childComponentId` = catalogComponent (0 when none).
- `catalog` filter activates: `linked` → `catalogComponent` present; `suggested` → `pendingSuggestionCount`>0; `none` → neither. Multi-value OR, applied at the group level.

### `GET /components/:id/bom` (spec 073 — fields go live)

- `resolvedComponent {id,slug,name}|null` per row (join on `resolvedComponentId`).
- `pendingSuggestionId` per row (PENDING `bom_component_suggestions` for the entry's `(componentId, purlIdentity)` — derived via the rep entry's identity, falling back to the child's verbatim-normalized `externalId` when the rep was pruned).
- `pendingSuggestionChildId` per row — the candidate component that suggestion targets; feeds the `?child=<id>` deep-link into the dependency queue.
- `catalog` filter activates: `linked` → `resolvedComponentId NOT NULL`; `suggested` → pending suggestion exists for the entry's identity; `none` → neither. UI precedence: *Suggested* > *Linked* (UX-BOM-08).

### `GET /components` — library visibility (UX-LIB-01)

| Param | Behaviour |
|---|---|
| `libraries` | `"1"`/`"true"` → include `LIBRARY`; absent → `category != 'LIBRARY'` |

Response adds `librariesHidden: number` — ACTIVE libraries excluded by the default population (drives "Show libraries (212)").

### `GET /components/:id/relationships` — bounded library counts (UX-LIB-05)

`relationships` gains `libraryCounts: { dependsOn: number, dependedOnBy: number }`; `LIBRARY`-category neighbours are excluded from the `dependsOn`/`dependedOnBy` lane arrays. Other lanes and `unavailableKinds` behaviour unchanged — the counts read degrades the same way.

### `GET /packages/consumers` — unchanged contract, new consumer

The Library detail's Used-by list and the `/packages` expander share this endpoint (`purl` = Library `externalId`).

## Errors

| Code | When |
|---|---|
| `VALIDATION_FAILED` (400) | unknown/malformed params or body fields |
| `NOT_FOUND` (404) | unknown purl identity (preview) / unknown componentId (link) |
| `CONFLICT` (409) | add on an existing identity; link to a RETIRED component |
| `AUTH_FORBIDDEN` (403) | non-EDITOR on any write |
