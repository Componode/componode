import type {
  DiscoveredAsset,
  DiscoveredAssetRelationship,
  DiscoveredBomEntry,
} from "../index.js";
import { mapEcosystemToProvider, packageSlugToken } from "../constants/package-mapping.js";
import { normalizePurlIdentity, purlEcosystem } from "./purl.js";

// ADR-133 — shared LIBRARY-asset shaping for declared-edge carriers
// (importer-github spec 076, importer-sbom-file spec 077). Hoisted from
// importer-github so every carrier emits the identical contract: a
// first-class LIBRARY component per SPDX package, `externalId` = the
// normalized version-free purl identity so the (LIBRARY, provider,
// externalId) dedup triple merges with Phase-2 curated libraries.

export function generateComponentSlug(name: string): string {
  return packageSlugToken(name);
}

export function purlType(purl: string): string {
  return purlEcosystem(purl) || "generic";
}

/** Outgoing DEPENDS_ON relationships for one edge position — the shared
 * `relationships[]` projection every declared-edge carrier emits. */
export function dependsOnRels(
  edges: readonly { from: string; to: string }[],
  fromId: string,
): DiscoveredAssetRelationship[] {
  return edges
    .filter((e) => e.from === fromId)
    .map((e) => ({ type: "DEPENDS_ON" as const, targetExternalId: e.to }));
}

export function buildLibraryAsset(
  identity: string,
  entry: DiscoveredBomEntry,
  relationships: DiscoveredAssetRelationship[],
): DiscoveredAsset {
  const type = purlType(entry.purl);
  return {
    category: "LIBRARY",
    provider: mapEcosystemToProvider(type, entry.purl),
    resourceType: type,
    name: entry.name,
    externalId: identity,
    slug: `pkg-${generateComponentSlug(type)}-${generateComponentSlug(entry.name) || "unnamed"}`,
    instances: [],
    details: {
      purl: entry.purl,
      ...(entry.version ? { version: entry.version } : {}),
    },
    ...(relationships.length > 0 ? { relationships } : {}),
  };
}

/** Flatten the entry tree and index each package by its normalized
 *  version-free purl identity (dedup target of the edge endpoints). */
export function indexBomEntries(
  entries: DiscoveredBomEntry[],
): Map<string, DiscoveredBomEntry> {
  const out = new Map<string, DiscoveredBomEntry>();
  const walk = (list: DiscoveredBomEntry[]) => {
    for (const e of list) {
      const identity = normalizePurlIdentity(e.purl);
      if (identity && !out.has(identity)) out.set(identity, e);
      if (e.children) walk(e.children);
    }
  };
  walk(entries);
  return out;
}
