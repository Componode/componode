import {
  parseCycloneDxDocument,
  parseSpdxDocument,
  probeEndpoint,
  urlSafetyError,
  validateDiscoveredAsset,
  SPDX_EDGE_SUBJECT,
  buildLibraryAsset,
  indexBomEntries,
  dependsOnRels,
  type DiscoveredAsset,
  type DiscoveredBomEntry,
  type Importer,
  type ImporterContext,
} from "@componode/core";
import { sbomFileConfigSchema } from "./config.js";

// Spec 073 US3 — ingest one CycloneDX JSON or SPDX JSON document onto an
// existing component's BOM. The component's dedup triple arrives in the
// config's `resolvedComponent` (injected at dispatch from componentSlug) —
// the importer never invents an identity, and a failed fetch/parse yields
// the component degraded (bomInventory UNAVAILABLE/ERROR, no bomEntries)
// rather than failing the run.

const MAX_REDIRECTS = 3;
const MAX_SBOM_BYTES = 25 * 1024 * 1024; // 25 MB — SBOMs are large but bounded

interface FetchOutcome {
  text?: string;
  status?: number;
  error?: string;
}

/** Bounded manual-redirect fetch — every hop is re-validated for URL
 *  safety + HTTPS (a redirect must not escape to an unsafe host). */
async function fetchSbomText(
  startUrl: string,
  signal: AbortSignal,
): Promise<FetchOutcome> {
  let url = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await probeEndpoint(url, signal, 30_000);
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return { status: res.status, error: "redirect without Location" };
      const next = new URL(location, url).toString();
      const reason = urlSafetyError(next);
      if (reason) return { status: res.status, error: `redirect target not allowed: ${reason}` };
      if (new URL(next).protocol !== "https:") {
        return { status: res.status, error: "redirect target is not HTTPS" };
      }
      url = next;
      continue;
    }
    if (!res.ok) {
      return { status: res.status, error: `HTTP ${res.status}` };
    }
    const declared = Number(res.headers.get("content-length") ?? 0);
    if (declared > MAX_SBOM_BYTES) {
      return { status: res.status, error: "document exceeds the 25 MB size limit" };
    }
    const text = await res.text();
    if (text.length > MAX_SBOM_BYTES) {
      return { status: res.status, error: "document exceeds the 25 MB size limit" };
    }
    return { text };
  }
  return { error: `too many redirects (>${MAX_REDIRECTS})` };
}

type Format = "cyclonedx" | "spdx";

function detectFormat(doc: Record<string, unknown>): Format | null {
  if (doc.bomFormat === "CycloneDX") return "cyclonedx";
  if (typeof doc.spdxVersion === "string" && doc.spdxVersion.startsWith("SPDX-")) return "spdx";
  return null;
}

export class SbomFileImporter implements Importer {
  readonly name = "sbom-file";
  readonly version = "1.1.0";

  async *run(
    config: Record<string, unknown>,
    _secrets: Record<string, string>,
    context: ImporterContext,
  ): AsyncGenerator<DiscoveredAsset> {
    if (context.signal.aborted) {
      return;
    }

    context.reportPhase("Initializing");
    const parsed = sbomFileConfigSchema.parse(config);
    const resolved = parsed.resolvedComponent;
    if (!resolved) {
      throw new Error(
        "sbom-file: no resolved component identity in scope — componentSlug could not be resolved at dispatch",
      );
    }

    await context.reportSourceIdentity({
      externalIdentity: `sbom-file:${parsed.sbomUrl}`,
      label: `SBOM file ${parsed.sbomUrl}`,
    });

    const base: DiscoveredAsset = {
      category: resolved.category,
      provider: resolved.provider,
      resourceType: "sbom:document",
      name: resolved.name,
      externalId: resolved.externalId,
      slug: resolved.slug,
      instances: [],
    };
    const degrade = (status: "UNAVAILABLE" | "FORBIDDEN" | "ERROR", message: string): DiscoveredAsset => ({
      ...base,
      details: { capabilities: { bomInventory: { status, message } } },
    });

    context.reportPhase("Fetching SBOM document");
    let fetched: FetchOutcome;
    try {
      fetched = await fetchSbomText(parsed.sbomUrl, context.signal);
    } catch (err) {
      if (context.signal.aborted) throw err;
      yield degrade("ERROR", `fetch failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (fetched.text === undefined) {
      const status =
        fetched.status === 401 || fetched.status === 403
          ? "FORBIDDEN"
          : fetched.status === 404
            ? "UNAVAILABLE"
            : "ERROR";
      yield degrade(status, fetched.error ?? "document fetch failed");
      return;
    }

    context.reportPhase("Parsing SBOM document");
    let doc: Record<string, unknown>;
    try {
      const parsedDoc: unknown = JSON.parse(fetched.text);
      if (!parsedDoc || typeof parsedDoc !== "object" || Array.isArray(parsedDoc)) {
        throw new Error("document is not a JSON object");
      }
      doc = parsedDoc as Record<string, unknown>;
    } catch (err) {
      yield degrade("ERROR", `parse failed: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }

    const format = detectFormat(doc);
    if (!format) {
      yield degrade(
        "UNAVAILABLE",
        "unrecognized SBOM format — expected CycloneDX JSON (bomFormat) or SPDX JSON (spdxVersion)",
      );
      return;
    }

    const result =
      format === "cyclonedx"
        ? parseCycloneDxDocument(doc as Parameters<typeof parseCycloneDxDocument>[0])
        : parseSpdxDocument(doc as Parameters<typeof parseSpdxDocument>[0]);

    // ADR-133 / spec 077 — when declared edges are opted in, SUBJECT
    // resolves to the configured component in both endpoint positions:
    // subject-declared edges attach to this asset, library-declared edges
    // attach to each LIBRARY asset yielded below.
    const edges = parsed.importDeclaredEdges
      ? result.edges.map((e) => ({
          from: e.from === SPDX_EDGE_SUBJECT ? resolved.externalId : e.from,
          to: e.to === SPDX_EDGE_SUBJECT ? resolved.externalId : e.to,
        }))
      : [];
    const componentRelationships = dependsOnRels(edges, resolved.externalId);

    const asset: DiscoveredAsset = {
      ...base,
      // Present (including empty) — collection finished, replace the
      // Source's prior set (ADR-057 A1).
      bomEntries: result.entries as DiscoveredBomEntry[],
      details: {
        capabilities: {
          bomInventory:
            result.skipped > 0
              ? {
                  status: "OK",
                  message: `${result.skipped} package(s) without a purl were skipped`,
                }
              : { status: "OK" },
        },
        bomDocument: { format, packagesSkipped: result.skipped },
      },
      // Under opt-in the subject ALWAYS carries the field — `[]` is the
      // authoritative-empty marker that lets the edge pass retire; a
      // degraded yield omits it entirely so the run stays non-authoritative
      // (ADR-057-style presence semantics, spec 077 FR-007).
      ...(parsed.importDeclaredEdges
        ? { relationships: componentRelationships }
        : {}),
    };
    validateDiscoveredAsset(asset);
    yield asset;

    // LIBRARY assets only under opt-in — they are the same-run resolution
    // targets for declared edges (and merge with curated libraries on the
    // standard dedup triple). A document with no dependency graph still
    // yields them; their relationships just stay absent.
    if (parsed.importDeclaredEdges) {
      for (const [identity, entry] of indexBomEntries(result.entries)) {
        const lib = buildLibraryAsset(identity, entry, dependsOnRels(edges, identity));
        validateDiscoveredAsset(lib);
        yield lib;
      }
    }
    context.reportPhase("Completed");
  }
}
