import type {
  BomDependencyScope,
  DiscoveredBomEntry,
} from "../index.js";
import { normalizePurlIdentity } from "./purl.js";

// SPDX 2.3 JSON → DiscoveredBomEntry[] (researches/sbom_research.md mapping
// tables). Shared by importer-sbom-file, importer-github (dependency-graph
// endpoint returns SPDX), and OCI-referrer SPDX attestations in
// importer-docker / importer-kubernetes. Importer packages may only depend
// on core (ADR-065) — the parser lives here.

interface SpdxPackage {
  SPDXID?: string;
  name?: string;
  versionInfo?: string;
  supplier?: string;
  downloadLocation?: string;
  licenseConcluded?: string;
  licenseDeclared?: string;
  checksums?: { algorithm?: string; checksumValue?: string }[];
  externalRefs?: {
    referenceCategory?: string;
    referenceType?: string;
    referenceLocator?: string;
  }[];
}

interface SpdxRelationship {
  spdxElementId?: string;
  relatedSpdxElement?: string;
  relationshipType?: string;
}

export interface SpdxDocument {
  spdxVersion?: string;
  SPDXID?: string;
  name?: string;
  packages?: SpdxPackage[];
  relationships?: SpdxRelationship[];
  documentDescribes?: string[];
}

const SPDX_SCOPE_MAP: Record<string, BomDependencyScope> = {
  RUNTIME_DEPENDENCY_OF: "RUNTIME",
  DEV_DEPENDENCY_OF: "DEV",
  BUILD_DEPENDENCY_OF: "BUILD",
  TEST_DEPENDENCY_OF: "TEST",
  OPTIONAL_DEPENDENCY_OF: "OPTIONAL",
  OPTIONAL_COMPONENT_OF: "OPTIONAL",
  DEPENDS_ON: "RUNTIME",
  DEPENDENCY_OF: "RUNTIME",
  DEV_TOOL_OF: "DEV",
  BUILD_TOOL_OF: "BUILD",
  TEST_TOOL_OF: "TEST",
  PROVIDED_DEPENDENCY_OF: "OPTIONAL",
  DYNAMIC_LINK: "RUNTIME",
  STATIC_LINK: "BUNDLED",
};

const NOASSERTION = new Set(["NOASSERTION", "NONE", ""]);

function cleanValue(v: string | undefined | null): string | null {
  if (!v || NOASSERTION.has(v)) return null;
  return v;
}

function cleanSupplier(v: string | undefined | null): string | null {
  const s = cleanValue(v);
  if (!s) return null;
  return s.replace(/^(Organization|Person|Tool):\s*/i, "").trim() || null;
}

export interface BomParseResult {
  entries: DiscoveredBomEntry[];
  /** Packages dropped because they carry no resolvable purl — bom_entries
   *  keys on purl, so un-purl'd elements cannot be stored (ADR-131). */
  skipped: number;
  /** ADR-133 — dependency edges projected to version-free purl identities,
   *  declaring→target direction (the target is the dependency). The
   *  document-described element appears as the `SUBJECT` sentinel — the
   *  caller substitutes its own externalId when attaching
   *  `relationships[]`. */
  edges: SpdxEdge[];
}

/** Sentinel for the document-described element in `BomParseResult.edges`. */
export const SPDX_EDGE_SUBJECT = "SUBJECT";

export interface SpdxEdge {
  from: string;
  to: string;
}

/**
 * Shared endpoint-resolve → self-skip → dedupe for BOM edge projections
 * (SPDX + CycloneDX). `pairs` are `[resolvedFrom, resolvedTo]` — undefined
 * endpoints and self-edges drop silently.
 */
export function dedupeEdges(
  pairs: Iterable<[from: string | undefined, to: string | undefined]>,
): SpdxEdge[] {
  const edges: SpdxEdge[] = [];
  const seen = new Set<string>();
  for (const [from, to] of pairs) {
    if (!from || !to || from === to) continue;
    const key = `${from} ${to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push({ from, to });
  }
  return edges;
}

/**
 * Parses an SPDX 2.3 JSON document into `DiscoveredBomEntry[]`.
 *
 * - Subject: the element named by `documentDescribes` / `DESCRIBES`
 *   relationships is the BOM's subject — it is not itself an entry.
 * - Scope: `X <type>_OF subject` and `subject DEPENDS_ON X` forms both map
 *   through the research relationship table; first match wins.
 * - Nesting: `CONTAINS`/`CONTAINED_BY` become `children[]`.
 * - `direct`: a package related directly to the subject is direct; one
 *   related only through other packages is transitive. When no dependency
 *   relationships mention a package at all, `direct` stays undefined and
 *   the scope default applies (service-layer rule).
 * - `evidenceSource` is left unset — the caller stamps the provenance that
 *   fits its collection path (`SBOM_DOCUMENT`, `REGISTRY_API`, `IMAGE_LAYER`).
 */
export function parseSpdxDocument(doc: SpdxDocument): BomParseResult {
  const relationships = doc.relationships ?? [];
  const packages = doc.packages ?? [];

  const described = new Set<string>(doc.documentDescribes ?? []);
  for (const rel of relationships) {
    if (rel.relationshipType === "DESCRIBES" && rel.relatedSpdxElement) {
      described.add(rel.relatedSpdxElement);
    }
  }

  // subject → the element the document describes. Prefer the explicit
  // documentDescribes list; fall back to DESCRIBES relationships.
  const subjectIds = described.size > 0 ? described : new Set<string>();

  // Index: spdxElementId → its package
  const byId = new Map<string, SpdxPackage>();
  for (const pkg of packages) {
    if (pkg.SPDXID) byId.set(pkg.SPDXID, pkg);
  }

  // Per-package scope + directness + parent bindings from relationships.
  const scopeOf = new Map<string, BomDependencyScope>();
  const directToSubject = new Set<string>();
  const depOfPackage = new Set<string>(); // mentioned in any dep relationship
  const parentOf = new Map<string, string>(); // child SPDXID → parent SPDXID
  // ADR-133 — dependency edges in SPDXID space, declaring→target
  // (`A *_DEPENDENCY_OF B` → B depends on A → [B, A]; `A DEPENDS_ON B`
  // → [A, B]). Projected to purl identities below.
  const rawEdges: Array<[string, string]> = [];

  for (const rel of relationships) {
    const type = rel.relationshipType ?? "";
    const from = rel.spdxElementId ?? "";
    const to = rel.relatedSpdxElement ?? "";
    if (!from || !to) continue;

    if (type === "CONTAINS") {
      parentOf.set(to, from);
      continue;
    }
    if (type === "CONTAINED_BY") {
      parentOf.set(from, to);
      continue;
    }
    if (!(type in SPDX_SCOPE_MAP)) continue;

    // declaring→target (target is the dependency): `A DEPENDS_ON B` and
    // `A {DYNAMIC,STATIC}_LINK B` run from→to; every `*_OF` form runs
    // reversed (`A DEPENDENCY_OF B` → B depends on A).
    rawEdges.push(
      type === "DEPENDS_ON" || type === "DYNAMIC_LINK" || type === "STATIC_LINK"
        ? [from, to]
        : [to, from],
    );

    // "from is TYPE_OF to" → `from` is a dependency of `to`.
    depOfPackage.add(from);
    if (!scopeOf.has(from)) scopeOf.set(from, SPDX_SCOPE_MAP[type]!);
    if (subjectIds.has(to)) directToSubject.add(from);

    // "to DEPENDS_ON from" is also expressed the other way round in some
    // producers; the _OF form above is canonical, but a bare DEPENDS_ON
    // whose `from` is the subject still marks `to` as a direct dep.
    if (type === "DEPENDS_ON" || type === "DEPENDENCY_OF") {
      depOfPackage.add(to);
      if (!scopeOf.has(to)) scopeOf.set(to, "RUNTIME");
      if (subjectIds.has(from)) directToSubject.add(to);
    }
  }

  const toEntry = (pkg: SpdxPackage): DiscoveredBomEntry | null => {
    const purl = pkg.externalRefs?.find(
      (r) => r.referenceType === "purl",
    )?.referenceLocator;
    if (!purl) return null;

    const license = cleanValue(pkg.licenseConcluded) ?? cleanValue(pkg.licenseDeclared);
    const checksums = (pkg.checksums ?? [])
      .filter((c) => c.algorithm && c.checksumValue)
      .map((c) => `${c.algorithm}:${c.checksumValue}`);
    const downloadLocation = cleanValue(pkg.downloadLocation);
    const details: Record<string, unknown> = {};
    if (checksums.length) details.checksums = checksums;
    if (downloadLocation) details.downloadLocation = downloadLocation;

    const id = pkg.SPDXID ?? "";
    const entry: DiscoveredBomEntry = {
      purl,
      name: pkg.name ?? purl,
      evidenceSource: "SBOM_DOCUMENT", // caller overrides per collection path
      version: cleanValue(pkg.versionInfo),
      scope: scopeOf.get(id),
      direct:
        directToSubject.size > 0 || depOfPackage.size > 0
          ? directToSubject.has(id)
            ? true
            : depOfPackage.has(id)
              ? false
              : undefined
          : undefined,
      supplier: cleanSupplier(pkg.supplier),
      licenses: license ? [license] : [],
      cdxBomRef: pkg.SPDXID ?? null,
      details: Object.keys(details).length ? details : null,
    };
    return entry;
  };

  // Two passes: build every entry by SPDXID, then attach children.
  const entryById = new Map<string, DiscoveredBomEntry>();
  const identityOf = new Map<string, string>(); // SPDXID → purl identity
  const topLevel: DiscoveredBomEntry[] = [];
  let skipped = 0;

  for (const pkg of packages) {
    if (pkg.SPDXID && subjectIds.has(pkg.SPDXID)) continue;
    const entry = toEntry(pkg);
    if (!entry) {
      skipped++;
      continue;
    }
    entryById.set(pkg.SPDXID!, entry);
    topLevel.push(entry);
    const identity = normalizePurlIdentity(entry.purl);
    if (identity) identityOf.set(pkg.SPDXID!, identity);
  }

  for (const [childId, parentId] of parentOf) {
    const child = entryById.get(childId);
    const parent = entryById.get(parentId);
    if (!child || !parent) continue;
    (parent.children ??= []).push(child);
    const idx = topLevel.indexOf(child);
    if (idx >= 0) topLevel.splice(idx, 1);
  }

  // ADR-133 — project SPDXID-space edges onto purl identities; subject
  // element ids become the SUBJECT sentinel for the caller to substitute.
  const identityOfSpdx = (id: string): string | undefined =>
    subjectIds.has(id) ? SPDX_EDGE_SUBJECT : identityOf.get(id);
  const edges = dedupeEdges(
    [...rawEdges].map(
      ([declaringId, targetId]): [string | undefined, string | undefined] => [
        identityOfSpdx(declaringId),
        identityOfSpdx(targetId),
      ],
    ),
  );

  return { entries: topLevel, skipped, edges };
}
