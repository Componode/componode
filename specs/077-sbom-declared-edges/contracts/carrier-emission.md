# Contract: SBOM File Carrier Emission

**No API contract changes** — no new or modified endpoints, no request or
response shape changes; `docs/openapi.yaml` is untouched (ADR-104 n/a).
The only contract surface is the **importer emission contract** the
carrier produces under ADR-133, and the manifest declaration that
activates the generic machinery.

## Manifest declaration

```ts
// packages/importer-sbom-file/src/manifest.ts
export const manifest = {
  // …existing fields unchanged…
  declaredEdgesConfigKey: "importDeclaredEdges", // NEW
};
```

Effects when the config's `scope.importDeclaredEdges === true`:

| Surface | Generic mechanism (spec 076, unchanged) |
|---|---|
| Backend run paths | `declaredEdgesEnabled` → collect `relationships[]` → `runImporterEdgePass` on `COMPLETED` (resolve-in-run, `ON CONFLICT DO NOTHING`, suppressed-pair skip, source-scoped diff retire) |
| Frontend form | Schema-driven switch renders the field's `.describe()` copy; hidden while `flags.bomImporterEdges` is OFF |
| Docs | `docs:importers` regenerates the `GENERATED:contract` table row |

## Emission contract (opt-in = true)

```text
result = parse{Spdx,CycloneDx}Document(doc)   # edges always present ([] ok)
edges  = result.edges with SUBJECT → resolved.externalId (both positions)

yield configured-component asset:
    …unchanged base/bomEntries/details…
    relationships  = [{ type:"DEPENDS_ON", targetExternalId: e.to }
                      for e in edges where e.from === resolvedExternalId]
                      # always present under opt-in — [] marks
                      # authoritative-empty (see invariants)

for each [identity, entry] in indexBomEntries(result.entries):
    yield LIBRARY asset (shared core shape — see data-model.md)
    relationships? = [{ type:"DEPENDS_ON", targetExternalId: e.to }
                      for e in edges where e.from === identity]
                      # omit when empty
```

Invariants (enforced by `validateDiscoveredAsset` + unit tests):

- `relationships` presence is the run's edge-completeness signal
  (mirroring `bomEntries`, ADR-057 A1): the declaring subject asset emits
  `[]` for authoritative-empty under opt-in so the pass may retire; a
  LIBRARY asset omits the field when it declares nothing; a degraded
  yield omits it everywhere so the run is non-authoritative and prior
  importer edges are preserved (FR-007).
- Emitted only when `parsed.importDeclaredEdges === true`; OFF ⇒ output
  identical to pre-feature (single component asset, no LIBRARY yields).
- All emitted `type` values are `"DEPENDS_ON"`.
- `targetExternalId` is emitted verbatim from the parsed edge (after
  `SUBJECT` substitution). Targets that resolve to no same-run asset —
  purls absent from `bomEntries`, self-edges — are silently dropped by
  the backend pass (the spec's edge-case ruling), not filtered by the
  importer.
- `validateDiscoveredAsset` runs on every yielded asset (component +
  each library), as today for the component asset.
