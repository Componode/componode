# Contract: DiscoveredAsset changes and adopt-on-report matching

Ratified in ADR-120 (extends ADR-056's asset contract).

## `DiscoveredAsset` additions

```ts
interface DiscoveredAsset {
  // ...existing fields unchanged...
  /** Source-specific facts for the Source membership — never canonical.
   *  Written to source_component_memberships.details on adopting runs;
   *  ignored on legacy runs. Distinct from `details`, which continues to
   *  write canonical components.details. */
  sourceDetails?: Record<string, unknown> | null;
}

interface DiscoveredAssetInstance {
  // ...existing fields unchanged...
  /** Source-specific facts for the instance membership. */
  sourceDetails?: Record<string, unknown> | null;
}
```

- Optional in both directions: existing importers compile unchanged;
  `validateDiscoveredAsset` accepts absence and validates shape when
  present (plain object, no arrays-only/scalars).
- Legacy runs (`sourceId = null`) ignore `sourceDetails` — no write
  target exists.

## Upsert matching order (adopting runs only)

```text
1. components where (category, provider, externalId = asset.externalId)
   → match → normal upsert + membership refresh
2. else, when sourceId != null AND asset.externalId is qualified:
   components where (category, provider,
                     externalId = legacyExternalId(asset.externalId))
   AND no effective-active membership held by another Source
   → match → set externalId := qualified form, normal upsert, membership
3. else → insert new component
```

- Step 2's guard blocks adoption when another Source holds an
  **effective-active** membership (active row whose Source is `ACTIVE`
  or `UNMONITORED` — ADR-119 A1). Rewriting a shared legacy row under a
  live Source would fork a duplicate on that Source's next report, so
  first reporter wins the merged legacy row; second reporter inserts
  its own qualified component. A `RETIRED` source's membership does not
  defend the row. The rewrite records an `entity_changes` audit row.
- Azure's `{identity}:{rtype}` externalId already embeds the subscription
  scope and is exempt from the `::` convention — re-qualifying would
  mass-rekey existing rows with no adoption gain (ADR-120 Amendment 1).
- Instances: `externalId` matching is scoped under the component
  (`componentId + externalId`) — instance IDs are component-local, no
  qualification needed; membership stamping unchanged.
- Non-adopting runs (`sourceId = null`): step 1 only — byte-identical
  legacy behavior.

## Importer manifest usage

`reportsSourceIdentity: true` on all eight manifests — the existing
enforcement (backend worker + agent executor) turns on. Importers that
cannot determine identity MUST fail the run before yield rather than
skip the report.
