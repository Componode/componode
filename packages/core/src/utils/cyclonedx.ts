import type {
  BomDependencyScope,
  BomCdxType,
  DiscoveredBomEntry,
} from "../index.js";
import { BOM_CDX_TYPES, BOM_DEPENDENCY_SCOPES } from "../index.js";
import type { BomParseResult } from "./spdx.js";
import { SPDX_EDGE_SUBJECT, dedupeEdges } from "./spdx.js";
import { normalizePurlIdentity } from "./purl.js";

// CycloneDX 1.5/1.6 JSON → DiscoveredBomEntry[] (researches/sbom_research.md
// mapping tables). Shared by importer-sbom-file and OCI-referrer CycloneDX
// attestations in importer-docker / importer-kubernetes. Importer packages
// may only depend on core (ADR-065) — the parser lives here.

interface CdxLicense {
  license?: { id?: string; name?: string };
  expression?: string;
}

interface CdxComponent {
  type?: string;
  "bom-ref"?: string;
  supplier?: { name?: string };
  author?: string;
  publisher?: string;
  name?: string;
  version?: string;
  scope?: string;
  hashes?: { alg?: string; content?: string }[];
  licenses?: CdxLicense[];
  purl?: string;
  cpe?: string;
  properties?: { name?: string; value?: string }[];
  components?: CdxComponent[];
}

interface CdxDependency {
  ref?: string;
  dependsOn?: string[];
}

interface CdxTool {
  vendor?: string;
  name?: string;
  version?: string;
}

export interface CycloneDxDocument {
  bomFormat?: string;
  specVersion?: string;
  metadata?: {
    component?: CdxComponent;
    tools?: CdxTool[] | { components?: CdxTool[]; services?: { name?: string }[] };
  };
  components?: CdxComponent[];
  dependencies?: CdxDependency[];
}

const CDX_SCOPE_MAP: Record<string, BomDependencyScope> = {
  required: "RUNTIME",
  optional: "OPTIONAL",
  excluded: "DEV",
};

const CDX_TYPE_SET = new Set<string>(BOM_CDX_TYPES);

function toolSummary(doc: CycloneDxDocument): string | null {
  const tools = doc.metadata?.tools;
  if (!tools) return null;
  const list: CdxTool[] = Array.isArray(tools)
    ? tools
    : [...(tools.components ?? []), ...(tools.services ?? [])];
  const names = list
    .map((t) => [t.name, t.version].filter(Boolean).join("@"))
    .filter(Boolean);
  return names.length ? names.join(",") : null;
}

function licensesOf(component: CdxComponent): string[] {
  const out: string[] = [];
  for (const lic of component.licenses ?? []) {
    if (lic.expression) out.push(lic.expression);
    else if (lic.license?.id) out.push(lic.license.id);
    else if (lic.license?.name) out.push(lic.license.name);
  }
  return out;
}

/**
 * Parses a CycloneDX JSON document into `DiscoveredBomEntry[]`.
 *
 * - `components[]` nesting maps to `children[]` at arbitrary depth.
 * - `dependencies[]` refines `direct`: an edge from the document's subject
 *   (`metadata.component.bom-ref`, else the declared root dependency ref)
 *   marks direct; edges only through other components mark transitive.
 *   When `dependencies[]` is absent, `direct` is left for the scope default.
 * - `evidenceSource` is left unset — the caller stamps the provenance that
 *   fits its collection path. `evidenceDetail` gets `metadata.tools`.
 */
export function parseCycloneDxDocument(doc: CycloneDxDocument): BomParseResult {
  const evidenceDetail = toolSummary(doc);
  const subjectRef = doc.metadata?.component?.["bom-ref"] ?? null;

  const deps = new Map<string, string[]>();
  for (const d of doc.dependencies ?? []) {
    if (d.ref) deps.set(d.ref, d.dependsOn ?? []);
  }
  const hasDepGraph = deps.size > 0;
  const directRefs = new Set<string>();
  const childRefs = new Set<string>();
  // The subject is metadata.component's bom-ref when present, else the
  // single dependency entry nothing else depends on (document root).
  // Hoisted: the edge projection below also maps it to SUBJECT.
  let rootRef = subjectRef;
  if (hasDepGraph) {
    if (!rootRef) {
      const dependedOn = new Set<string>();
      for (const children of deps.values()) {
        for (const c of children) dependedOn.add(c);
      }
      const roots = [...deps.keys()].filter((r) => !dependedOn.has(r));
      rootRef = roots.length === 1 ? roots[0]! : null;
    }
    for (const r of deps.get(rootRef ?? "") ?? []) directRefs.add(r);
    for (const children of deps.values()) {
      for (const c of children) childRefs.add(c);
    }
  }

  let skipped = 0;

  const toEntry = (component: CdxComponent): DiscoveredBomEntry | null => {
    if (!component.purl) {
      skipped++;
      return null;
    }
    const checksums = (component.hashes ?? [])
      .filter((h) => h.alg && h.content)
      .map((h) => `${h.alg}:${h.content}`);
    const details: Record<string, unknown> = {};
    if (checksums.length) details.checksums = checksums;
    if (component.cpe) details.cpe = component.cpe;

    const ref = component["bom-ref"];
    // Componode exports keep the lossy scope mapping but restore fidelity
    // through namespaced properties — a re-ingested export lands on the
    // same dedupe key instead of duplicating (spec 073 SC-003).
    const props = new Map(
      (component.properties ?? [])
        .filter((p) => typeof p?.name === "string")
        .map((p) => [p.name!, p.value ?? ""]),
    );
    const propScope = props.get("componode:scope");
    const propDirect = props.get("componode:direct");
    const entry: DiscoveredBomEntry = {
      purl: component.purl,
      name: component.name ?? component.purl,
      evidenceSource: "SBOM_DOCUMENT", // caller overrides per collection path
      evidenceDetail,
      version: component.version ?? null,
      scope:
        propScope && (BOM_DEPENDENCY_SCOPES as readonly string[]).includes(propScope)
          ? (propScope as BomDependencyScope)
          : (CDX_SCOPE_MAP[component.scope ?? "required"] ?? "RUNTIME"),
      direct:
        propDirect !== undefined
          ? propDirect === "true"
          : hasDepGraph
            ? directRefs.has(ref ?? "")
              ? true
              : childRefs.has(ref ?? "")
                ? false
                : undefined
            : undefined,
      supplier:
        component.supplier?.name ??
        component.author ??
        component.publisher ??
        null,
      licenses: licensesOf(component),
      cdxType:
        component.type && CDX_TYPE_SET.has(component.type)
          ? (component.type as BomCdxType)
          : null,
      cdxBomRef: ref ?? null,
      details: Object.keys(details).length ? details : null,
    };

    const children = (component.components ?? [])
      .map(toEntry)
      .filter((e): e is DiscoveredBomEntry => e !== null);
    if (children.length) entry.children = children;
    return entry;
  };

  const entries = (doc.components ?? [])
    .map(toEntry)
    .filter((e): e is DiscoveredBomEntry => e !== null);

  // ADR-133 — project dependencies[] (ref → dependsOn refs, declaring→
  // target) onto version-free purl identities; the subject ref becomes the
  // SUBJECT sentinel for the caller to substitute.
  const identityOf = new Map<string, string>();
  const collectIdentities = (components?: CdxComponent[]): void => {
    for (const c of components ?? []) {
      const ref = c["bom-ref"];
      if (ref && c.purl) {
        const identity = normalizePurlIdentity(c.purl);
        if (identity) identityOf.set(ref, identity);
      }
      collectIdentities(c.components);
    }
  };
  collectIdentities(doc.components);

  const refEnd = (ref: string): string | undefined =>
    ref === rootRef ? SPDX_EDGE_SUBJECT : identityOf.get(ref);
  const pairs: [string | undefined, string | undefined][] = [];
  for (const [ref, children] of deps) {
    for (const child of children) {
      pairs.push([refEnd(ref), refEnd(child)]);
    }
  }
  const edges = dedupeEdges(pairs);

  return { entries, skipped, edges };
}
