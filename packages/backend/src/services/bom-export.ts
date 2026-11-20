import { Readable } from "node:stream";
import type { Selectable } from "kysely";
import { db } from "../db/connection.js";
import type { BomEntryRow } from "../db/types.js";
import type { BomDependencyScope } from "@componode/core";

/** Select-side shape — Generated<> columns resolve to their select type. */
type Row = Selectable<BomEntryRow>;

/**
 * BOM export serializers (spec 073 US4, contracts/bom-api.md). Reverse
 * mappings follow researches/sbom_research.md:
 *  - CycloneDX scope collapse: BUILD/DEV/TEST → "excluded" (lossy —
 *    disclosed in the export menu, UX-EXP-02).
 *  - SPDX: scope → relationshipType anchored on the document subject;
 *    nesting → CONTAINS; `direct` preserved by anchoring non-direct
 *    entries on their parent (or SPDXRef-DOCUMENT when top-level).
 *  - Componode JSON: the full tree verbatim for round-tripping.
 */

const CDX_SCOPE: Record<BomDependencyScope, "required" | "optional" | "excluded"> = {
  RUNTIME: "required",
  DEV: "excluded",
  BUILD: "excluded",
  TEST: "excluded",
  SYSTEM: "required",
  OPTIONAL: "optional",
  BUNDLED: "required",
  TRANSITIVE: "required",
};

const SPDX_SCOPE_REL: Record<BomDependencyScope, string> = {
  RUNTIME: "RUNTIME_DEPENDENCY_OF",
  DEV: "DEV_DEPENDENCY_OF",
  BUILD: "BUILD_DEPENDENCY_OF",
  TEST: "TEST_DEPENDENCY_OF",
  SYSTEM: "RUNTIME_DEPENDENCY_OF",
  OPTIONAL: "OPTIONAL_DEPENDENCY_OF",
  BUNDLED: "DYNAMIC_LINK",
  TRANSITIVE: "DEPENDENCY_OF",
};

interface Tree {
  row: Row;
  children: Tree[];
}

function buildTree(rows: Row[]): Tree[] {
  const byParent = new Map<string | null, Row[]>();
  for (const r of rows) {
    const key = r.parentBomEntryId;
    const list = byParent.get(key) ?? [];
    list.push(r);
    byParent.set(key, list);
  }
  const make = (row: Row): Tree => ({
    row,
    children: (byParent.get(row.id) ?? []).map(make),
  });
  return (byParent.get(null) ?? [])
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(make);
}

function licenses(row: Row): string[] {
  return Array.isArray(row.licenses) ? (row.licenses as string[]) : [];
}

function checksums(row: Row): { alg: string; content: string }[] {
  const raw = (row.details as Record<string, unknown> | null)?.checksums;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is string => typeof c === "string" && c.includes(":"))
    .map((c) => {
      const i = c.indexOf(":");
      return { alg: c.slice(0, i), content: c.slice(i + 1) };
    });
}

function cpe(row: Row): string | null {
  const v = (row.details as Record<string, unknown> | null)?.cpe;
  return typeof v === "string" ? v : null;
}

// SPDX checksumAlgorithm enum uses "SHA256" (no dash); CDX "SHA-256".
const toSpdxAlg = (alg: string) => alg.toUpperCase().replace(/^SHA-(\d)/, "SHA$1");
const toCdxAlg = (alg: string) => alg.toUpperCase().replace(/^SHA(\d)/, "SHA-$1");

// CycloneDX 1.5 constrains hash alg + content; a stored checksum that
// doesn't fit must not break schema validity (FR-012) — emit only
// conforming hashes.
const CDX_HASH_ALGS = new Set([
  "MD5", "SHA-1", "SHA-256", "SHA-384", "SHA-512",
  "SHA3-256", "SHA3-384", "SHA3-512",
  "BLAKE2B-256", "BLAKE2B-384", "BLAKE2B-512", "BLAKE3",
]);
const CDX_HASH_CONTENT = /^([a-fA-F0-9]{32}|[a-fA-F0-9]{40}|[a-fA-F0-9]{64}|[a-fA-F0-9]{96}|[a-fA-F0-9]{128})$/;

// --- CycloneDX ---------------------------------------------------------------

interface CdxComponent {
  type: string;
  "bom-ref": string;
  supplier?: { name: string };
  author?: string;
  name: string;
  version?: string;
  scope: string;
  hashes?: { alg: string; content: string }[];
  licenses?: { expression: string }[];
  purl?: string;
  cpe?: string;
  properties?: { name: string; value: string }[];
  components?: CdxComponent[];
}

const BOM_CDX_TYPE_SET = new Set([
  "application", "framework", "library", "container", "platform", "os",
  "device", "device-driver", "firmware", "file", "machine-learning-model", "data",
]);

export function buildCycloneDx(
  rows: Row[],
  component: { slug: string; name: string },
): Record<string, unknown> {
  const tree = buildTree(rows);
  // bom-ref assignment: cdxBomRef when the row kept one, else the purl —
  // deduped so dependencies[] refs resolve unambiguously.
  const usedRefs = new Set<string>();
  const refOf = (row: Row): string => {
    let ref = row.cdxBomRef ?? row.purl;
    let i = 2;
    while (usedRefs.has(ref)) ref = `${row.cdxBomRef ?? row.purl}-${i++}`;
    usedRefs.add(ref);
    return ref;
  };

  const subjectRef = `component:${component.slug}`;
  const deps = new Map<string, string[]>();
  const addDep = (ref: string, childRef: string) => {
    const list = deps.get(ref) ?? [];
    list.push(childRef);
    deps.set(ref, list);
  };

  const toComponent = (t: Tree): CdxComponent => {
    const { row } = t;
    const ref = refOf(row);
    const children = t.children.map(toComponent);
    for (const c of t.children) addDep(ref, refOf(c.row));
    if (row.direct) addDep(subjectRef, ref);
    // Top-level non-direct entries anchor on a synthetic ref — keeps the
    // subject's dependsOn list honest instead of marking them direct.
    else if (!row.parentBomEntryId) addDep("indirect-dependencies", ref);

    const out: CdxComponent = {
      type: row.cdxType && BOM_CDX_TYPE_SET.has(row.cdxType) ? row.cdxType : "library",
      "bom-ref": ref,
      name: row.name,
      scope: CDX_SCOPE[(row.scope as BomDependencyScope) ?? "RUNTIME"] ?? "required",
    };
    if (row.version) out.version = row.version;
    if (row.supplier) out.supplier = { name: row.supplier };
    const lics = licenses(row);
    // CDX allows one license-expression element — conjunctive join.
    if (lics.length) out.licenses = [{ expression: lics.join(" AND ") }];
    const sums = checksums(row)
      .map((s) => ({ alg: toCdxAlg(s.alg), content: s.content }))
      .filter((s) => CDX_HASH_ALGS.has(s.alg) && CDX_HASH_CONTENT.test(s.content));
    if (sums.length) out.hashes = sums;
    const cpeValue = cpe(row);
    if (cpeValue) out.cpe = cpeValue;
    out.purl = row.purl;
    // Namespaced properties restore the true scope/direct on re-ingest —
    // the lossy `scope` field stays per the research table for external
    // consumers, while the export round-trips without duplicating (SC-003).
    out.properties = [
      { name: "componode:scope", value: row.scope },
      { name: "componode:direct", value: String(row.direct) },
    ];
    if (children.length) out.components = children;
    return out;
  };

  const components = tree.map(toComponent);
  // Anchor refs that were never assigned a component stay in `deps` —
  // CycloneDX tolerates dependency refs beyond the component set.
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: { components: [{ type: "application", name: "Componode", version: "1.0" }] },
      component: { type: "application", name: component.name, "bom-ref": subjectRef },
    },
    components,
    dependencies: [...deps.entries()].map(([ref, dependsOn]) => ({ ref, dependsOn })),
  };
}

// --- SPDX --------------------------------------------------------------------

function sanitizeSpdxId(raw: string): string {
  return `SPDXRef-${raw.replace(/[^a-zA-Z0-9.-]/g, "-")}`;
}

export function buildSpdx(
  rows: Row[],
  component: { slug: string; name: string },
  instance?: { slug: string } | null,
): Record<string, unknown> {
  const tree = buildTree(rows);
  const usedIds = new Set<string>(["SPDXRef-DOCUMENT", "SPDXRef-subject"]);
  const idOf = (row: Row): string => {
    const base = sanitizeSpdxId(row.cdxBomRef ?? row.purl);
    let id = base;
    let i = 2;
    while (usedIds.has(id)) id = `${base}-${i++}`;
    usedIds.add(id);
    return id;
  };

  const packages: Record<string, unknown>[] = [
    {
      SPDXID: "SPDXRef-subject",
      name: instance ? `${component.name} (${instance.slug})` : component.name,
      downloadLocation: "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: "NOASSERTION",
      licenseDeclared: "NOASSERTION",
      copyrightText: "NOASSERTION",
    },
  ];
  const relationships: Record<string, string>[] = [
    {
      spdxElementId: "SPDXRef-DOCUMENT",
      relationshipType: "DESCRIBES",
      relatedSpdxElement: "SPDXRef-subject",
    },
  ];

  const walk = (t: Tree, parentId: string | null): string => {
    const { row } = t;
    const id = idOf(row);
    const lics = licenses(row);
    const licenseExpr = lics.length ? lics.join(" AND ") : "NOASSERTION";
    const pkg: Record<string, unknown> = {
      SPDXID: id,
      name: row.name,
      downloadLocation:
        ((row.details as Record<string, unknown> | null)?.downloadLocation as string | undefined) ??
        "NOASSERTION",
      filesAnalyzed: false,
      licenseConcluded: licenseExpr,
      licenseDeclared: licenseExpr,
      copyrightText: "NOASSERTION",
      externalRefs: [
        {
          referenceCategory: "PACKAGE-MANAGER",
          referenceType: "purl",
          referenceLocator: row.purl,
        },
      ],
    };
    if (row.version) pkg.versionInfo = row.version;
    if (row.supplier) pkg.supplier = `Organization: ${row.supplier}`;
    const sums = checksums(row);
    if (sums.length)
      pkg.checksums = sums.map((s) => ({ algorithm: toSpdxAlg(s.alg), checksumValue: s.content }));
    packages.push(pkg);

    // Scope relationship: direct → subject anchor; otherwise the parent
    // package, or SPDXRef-DOCUMENT for a top-level transitive.
    const anchor = row.direct ? "SPDXRef-subject" : (parentId ?? "SPDXRef-DOCUMENT");
    relationships.push({
      spdxElementId: id,
      relationshipType: SPDX_SCOPE_REL[(row.scope as BomDependencyScope) ?? "RUNTIME"] ?? "DEPENDENCY_OF",
      relatedSpdxElement: anchor,
    });
    for (const c of t.children) {
      const childId = walk(c, id);
      relationships.push({
        spdxElementId: id,
        relationshipType: "CONTAINS",
        relatedSpdxElement: childId,
      });
    }
    return id;
  };
  for (const t of tree) walk(t, null);

  return {
    spdxVersion: "SPDX-2.3",
    dataLicense: "CC0-1.0",
    SPDXID: "SPDXRef-DOCUMENT",
    name: instance ? `${component.slug}-${instance.slug}-bom` : `${component.slug}-bom`,
    documentNamespace: `https://componode.invalid/sbom/${component.slug}/${Date.now()}`,
    creationInfo: {
      created: new Date().toISOString(),
      creators: ["Tool: componode-1.0"],
    },
    documentDescribes: ["SPDXRef-subject"],
    packages,
    relationships,
  };
}

// --- Componode JSON ------------------------------------------------------------

interface JsonEntry {
  purl: string;
  name: string;
  version: string | null;
  ecosystem: string;
  scope: string;
  direct: boolean;
  evidenceSource: string;
  evidenceDetail: string | null;
  licenses: string[];
  supplier: string | null;
  cdxType: string | null;
  cdxBomRef: string | null;
  details: Record<string, unknown> | null;
  children: JsonEntry[];
}

export function buildComponodeJson(
  rows: Row[],
  component: { id: string; slug: string; name: string },
  instance?: { id: string; slug: string; environment: string } | null,
): Record<string, unknown> {
  const toEntry = (t: Tree): JsonEntry => ({
    purl: t.row.purl,
    name: t.row.name,
    version: t.row.version,
    ecosystem: t.row.ecosystem,
    scope: t.row.scope,
    direct: t.row.direct,
    evidenceSource: t.row.evidenceSource,
    evidenceDetail: t.row.evidenceDetail,
    licenses: licenses(t.row),
    supplier: t.row.supplier,
    cdxType: t.row.cdxType,
    cdxBomRef: t.row.cdxBomRef,
    details: t.row.details,
    children: t.children.map(toEntry),
  });
  return {
    format: "componode-bom",
    version: 1,
    generatedAt: new Date().toISOString(),
    component: { id: component.id, slug: component.slug, name: component.name },
    instance: instance ?? null,
    entries: buildTree(rows).map(toEntry),
  };
}

// --- Route-facing export read --------------------------------------------------

export interface BomExportResult {
  filename: string;
  contentType: string;
  stream: Readable;
}

/**
 * Loads the full BOM for a component (or one instance — list filters never
 * apply, Q3) and serializes it. Returns null when the component (or the
 * requested instance) doesn't exist — the route maps that to NOT_FOUND.
 */
export async function exportBom(
  componentId: string,
  format: "json" | "cyclonedx" | "spdx",
  instanceId?: string,
): Promise<BomExportResult | null> {
  const component = await db
    .selectFrom("components")
    .select(["id", "slug", "name"])
    .where("id", "=", componentId)
    .executeTakeFirst();
  if (!component) return null;

  let instance: { id: string; slug: string; environment: string } | null = null;
  if (instanceId) {
    const row = await db
      .selectFrom("component_instances")
      .select(["id", "slug", "environment"])
      .where("id", "=", instanceId)
      .where("componentId", "=", componentId)
      .executeTakeFirst();
    if (!row) return null;
    instance = row;
  }

  const rows = await db
    .selectFrom("bom_entries")
    .selectAll()
    .where("componentId", "=", componentId)
    .where(
      "componentInstanceId",
      instanceId ? "=" : "is",
      instanceId ?? null,
    )
    .orderBy("name", "asc")
    .execute();

  const base = `${component.slug}${instance ? `-${instance.slug}` : ""}-bom`;
  if (format === "json") {
    return {
      filename: `${base}.json`,
      contentType: "application/json",
      stream: Readable.from(JSON.stringify(buildComponodeJson(rows, component, instance), null, 2)),
    };
  }
  if (format === "cyclonedx") {
    return {
      filename: `${base}.cdx.json`,
      contentType: "application/json",
      stream: Readable.from(JSON.stringify(buildCycloneDx(rows, component), null, 2)),
    };
  }
  return {
    filename: `${base}.spdx.json`,
    contentType: "application/json",
    stream: Readable.from(JSON.stringify(buildSpdx(rows, component, instance), null, 2)),
  };
}
