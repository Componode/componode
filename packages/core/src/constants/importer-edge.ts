// Spec 076 / ADR-133 — importer-declared component edges (v2 contract).
// `relationships[]` on DiscoveredAsset declares component-level edges an
// opted-in importer asserts within one run. Provenance distinguishes
// human-curated edges from importer-added ones; suppressions let users
// hide an importer-added edge durably.

export const DISCOVERED_RELATIONSHIP_TYPES = [
  "DEPENDS_ON",
  "SOURCES_FROM",
  "EXPOSES",
] as const;

export type DiscoveredRelationshipType =
  (typeof DISCOVERED_RELATIONSHIP_TYPES)[number];

export const EDGE_PROVENANCES = ["CURATED", "IMPORTER"] as const;

export type EdgeProvenance = (typeof EDGE_PROVENANCES)[number];

// The component-edge kinds an importer can declare — same values as
// DISCOVERED_RELATIONSHIP_TYPES, named for the junction/suppression side
// where "kind" is the persisted column name.
export const EDGE_KINDS = DISCOVERED_RELATIONSHIP_TYPES;

export type EdgeKind = (typeof EDGE_KINDS)[number];

export interface EdgeJunctionRef {
  table: string;
  fromColumn: string;
  toColumn: string;
}

// Declaring asset → junction columns (data-model.md direction table).
// `.table` is consumed by the backend edge store/pass; `fromColumn`/
// `toColumn` declare the direction contract — the store writes literal
// column names per kind because Kysely needs static columns for typing.
export const EDGE_JUNCTION: Record<EdgeKind, EdgeJunctionRef> = {
  DEPENDS_ON: {
    table: "component_depends_on_component",
    fromColumn: "parentId",
    toColumn: "childId",
  },
  SOURCES_FROM: {
    table: "component_sources_from",
    fromColumn: "serviceId",
    toColumn: "repositoryId",
  },
  EXPOSES: {
    table: "component_exposes",
    fromColumn: "serviceId",
    toColumn: "apiId",
  },
};
