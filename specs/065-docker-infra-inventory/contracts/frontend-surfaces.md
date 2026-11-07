# Contract: frontend rendering surfaces (spec 065)

Bounded, allowlist-only rendering in `packages/frontend` — no generic
`details` dump anywhere. Component-level `details` only (these assets
have `instances: []`, so no instance-expander work).

## Component Details card — resourceType-keyed sections

| `resourceType` | Section | `details` keys rendered |
|---|---|---|
| `network` | Network | driver, scope, internal/attachable/ingress/configOnly/enableIPv6 flags, createdAt, attachedCount, attachedContainers (names), labels |
| `volume` | Volume | driver, scope, createdAt, sizeBytes (human-readable), refCount, reclaimable, labels |

Wiring: `component-detail.tsx` Details card gains
`{c.resourceType === "network" ? <NetworkDetailsSection …/> : null}` and
the `"volume"` equivalent — identical pattern to the existing
`docker-engine`/`image` sections. Shapers (`networkDetailsOf`,
`volumeDetailsOf`) extract ONLY allowlisted keys; unrecognized shapes
return `null` → nothing renders (foreign `details` never leak).

## Implementation shape

New shapers + section components live in
`ux/components/catalog/docker-details.tsx` beside
`EngineDetailsSection`/`ImageDetailsSection`, reusing `DescriptionList`,
`Badge`, `RelativeTime`, and the `formatBytes` helper already in the
module. `view-types.ts` needs no changes (`details` is already
`Record<string, unknown>`).

Labels render as a key→value list (same treatment as image `ociLabels`).
`attachedContainers` renders as a name list/badges; `attachedCount`
renders as a count. Booleans render only the flags the importer emitted
(only-when-true upstream).
