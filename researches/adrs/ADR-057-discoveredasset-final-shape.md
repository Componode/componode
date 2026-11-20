### ADR-057 — DiscoveredAsset final shape (supersedes ADR-025)

> **Status:** Ratified

**Context**: [ADR-025](./ADR-025-importer-interface-pull-only-asyncgenerator.md) defined `DiscoveredAsset` with `instances?` and
`relationships?` (reserved for v2). Q2–Q4 refined instance reconciliation.

**Decision**: **Final `DiscoveredAsset` shape:**

```typescript
interface DiscoveredAsset {
  category: ComponentCategory;
  provider: ComponentProvider;
  externalId: string;
  name: string;
  resourceType?: string;
  slug?: string;                     // importer-suggested ([ADR-046](./ADR-046-slug-generation-and-uniqueness.md): core may suffix)
  details?: Record<string, unknown>;
  instances?: ComponentInstanceData[];
  // relationships[] removed from v1 contract ([ADR-019](./ADR-019-hierarchy-authoring-manual-for-v1.md): manual hierarchy for v1)
}

interface ComponentInstanceData {
  externalId: string;                // required ([ADR-034](./ADR-034-componentinstance-upsert-key.md): upsert key)
  environment: ComponentEnvironment; // required ([ADR-014](./ADR-014-environment-separate-componentinstance-entity.md) enum)
  url?: string;
  region?: string;
  status?: ComponentInstanceStatus;  // optional (importer may not know)
  version?: string;
  deployedAt?: Date;
  rawConfig?: Record<string, unknown>;
}
```

**Rationale**: `relationships[]` removed entirely from v1 (not just reserved)
— adding importer-declared edges would expand the contract surface for a v2
feature. `slug?` added as importer-suggested ([ADR-046](./ADR-046-slug-generation-and-uniqueness.md)). `ComponentInstanceData.
externalId` required ([ADR-034](./ADR-034-componentinstance-upsert-key.md)). `environment` required (prevents null-env
pollution). `status` optional (importer may not know operational state).
## Amendment 1 — `bomEntries` factual inventory (spec 073, ADR-131)

**Context**: Phase 1 of the SBOM programme lets importers report the
*package inventory* of a component or instance (npm, PyPI, OS packages,
container layers). Package inventory is **factual data** — what *exists*
inside a component — not a graph-edge declaration. The v1 prohibition on
importer-declared `relationships[]` is unchanged.

**Decision**: `DiscoveredAsset` and `DiscoveredAssetInstance` gain an
optional `bomEntries?: DiscoveredBomEntry[]` field:

- Entries persist to the `bom_entries` table ([ADR-131](./ADR-131-bom-entry-entity.md)) keyed by
  `(componentId, purl, scope, componentInstanceId, parentBomEntryId)` —
  never to graph edges.
- **Field presence is the completeness signal**: present (including `[]`)
  means collection ran — the Source's prior set in that
  `(componentId, componentInstanceId)` scope is replaced on `COMPLETED`
  runs. Absent means collection was not attempted or failed — prior
  entries are preserved untouched. Failed, cancelled, and interrupted
  runs never replace.
- Entries may nest via `children[]` (container layer → OS package →
  language package); persistence uses the self-parent FK, not flattening.

**Rationale**: A BOM row describes what a component *contains*, which is
the factual layer Principle V assigns to importers. No row ever creates
or implies a `DEPENDS_ON`/`SOURCES_FROM` edge — catalog curation of
package identity is a Phase-2 concern (`resolvedComponentId`, ADR-131).
