import type { DiscoveredBomEntry } from "../contracts/discovered-asset.js";
import { parseCycloneDxDocument } from "./cyclonedx.js";
import {
  parseSpdxDocument,
  type BomParseResult,
  type SpdxEdge,
} from "./spdx.js";

// OCI Referrers SBOM resolution (spec 073 / ADR-131). Shared by
// importer-docker (image attestations) and importer-kubernetes (pod image
// attestations) — importer packages may only depend on core (ADR-065), so
// the registry client lives here. Pure fetch — the node-only Syft
// subprocess fallback stays inside importer-docker.

export interface BomCapabilityMarker {
  status: "OK" | "FORBIDDEN" | "ERROR" | "UNAVAILABLE";
  message?: string;
}

export interface ImageBomResult {
  entries?: DiscoveredBomEntry[];
  /** ADR-133 / spec 078 — the document's dependency graph, projected to
   *  version-free purl identities with the SUBJECT sentinel intact for
   *  the carrier to substitute. Present iff `entries` is present. */
  edges?: SpdxEdge[];
  marker: BomCapabilityMarker;
}

export interface ParsedImageRef {
  registry: string;
  repository: string;
  digest: string;
}

const DOCKER_HUB_API = "registry-1.docker.io";
const DOCKER_HUB_AUTH_REALM = "https://auth.docker.io/token";
const DOCKER_HUB_AUTH_SERVICE = "registry.docker.io";

/**
 * Parses `repo@sha256:digest` (RepoDigests/pod-image digest form) into
 * registry coordinates. Docker Hub is the default registry; bare
 * single-segment repos get `library/`.
 */
export function parseRepoDigest(ref: string): ParsedImageRef | null {
  const at = ref.lastIndexOf("@");
  if (at <= 0) return null;
  const digest = ref.slice(at + 1);
  if (!/^sha[0-9a-f]+:[0-9a-f]+$/i.test(digest)) return null;
  const repoPath = ref.slice(0, at);
  const first = repoPath.split("/")[0] ?? "";
  const hasRegistry =
    first.includes(".") || first.includes(":") || first === "localhost";
  const registry = hasRegistry ? first : DOCKER_HUB_API;
  const repository = hasRegistry ? repoPath.slice(first.length + 1) : repoPath;
  if (!repository) return null;
  return {
    registry,
    repository:
      hasRegistry || repository.includes("/")
        ? repository
        : `library/${repository}`,
    digest,
  };
}

export interface RegistryClient {
  getJson(url: string, accept?: string): Promise<unknown>;
}

// Minimal registry GET with the Docker v2 Bearer dance: a 401 carrying
// `WWW-Authenticate: Bearer realm=…,service=…,scope=…` is answered by an
// anonymous token fetch and one retry. Credentials beyond anonymous pulls
// are out of scope — a failed auth surfaces as a degraded marker.
export function makeRegistryClient(registry: string): RegistryClient {
  let token: string | null = null;

  const request = async (url: string, accept?: string): Promise<Response> => {
    const headers: Record<string, string> = {};
    if (accept) headers.Accept = accept;
    if (token) headers.Authorization = `Bearer ${token}`;
    return fetch(url, { headers });
  };

  const authenticate = async (challenge: string): Promise<boolean> => {
    const m =
      /Bearer\s+realm="([^"]+)"(?:\s*,\s*service="([^"]*)")?(?:\s*,\s*scope="([^"]*)")?/i.exec(
        challenge,
      );
    if (!m?.[1]) return false;
    const params = new URLSearchParams();
    if (m[2]) params.set("service", m[2]);
    if (m[3]) params.set("scope", m[3]);
    const resp = await fetch(`${m[1]}?${params}`);
    if (!resp.ok) return false;
    const body = (await resp.json()) as {
      token?: string;
      access_token?: string;
    };
    token = body.token ?? body.access_token ?? null;
    return token !== null;
  };

  // Docker Hub hardcodes its own auth realm/service rather than relying on
  // the challenge round-trip.
  const hubPreAuth = async () => {
    if (registry !== DOCKER_HUB_API || token) return;
    await authenticate(
      `Bearer realm="${DOCKER_HUB_AUTH_REALM}",service="${DOCKER_HUB_AUTH_SERVICE}"`,
    );
  };

  return {
    async getJson(url, accept) {
      await hubPreAuth();
      let resp = await request(url, accept);
      if (resp.status === 401) {
        const challenge = resp.headers.get("www-authenticate") ?? "";
        if (await authenticate(challenge)) {
          resp = await request(url, accept);
        }
      }
      if (!resp.ok) {
        const err = new Error(
          `registry GET ${url} → ${resp.status}`,
        ) as Error & { status?: number };
        err.status = resp.status;
        throw err;
      }
      return resp.json();
    },
  };
}

const SBOM_ARTIFACT_TYPES = [
  "application/vnd.cyclonedx+json",
  "application/vnd.spdx+json",
  "application/vnd.in-toto+json",
  "application/vnd.dev.sigstore.bundle+json",
];

function detectSbomDoc(
  doc: Record<string, unknown>,
): Record<string, unknown> | null {
  // in-toto attestation wrapper — the SBOM lives in `predicate`.
  const predicate = doc.predicate as Record<string, unknown> | undefined;
  const target = doc.bomFormat || doc.spdxVersion ? doc : predicate;
  if (!target) return null;
  if (target.bomFormat === "CycloneDX" || target.spdxVersion) return target;
  return null;
}

function parseDoc(doc: Record<string, unknown>): BomParseResult {
  if (doc.bomFormat === "CycloneDX") {
    return parseCycloneDxDocument(
      doc as Parameters<typeof parseCycloneDxDocument>[0],
    );
  }
  if (doc.spdxVersion) {
    return parseSpdxDocument(doc as Parameters<typeof parseSpdxDocument>[0]);
  }
  return { entries: [], skipped: 0, edges: [] };
}

/** Stamps evidence on a parsed entry tree — IMAGE_LAYER + caller's detail. */
export function stampImageLayerEvidence(
  entries: DiscoveredBomEntry[],
  evidenceDetail: string,
): void {
  for (const e of entries) {
    e.evidenceSource = "IMAGE_LAYER";
    e.evidenceDetail = evidenceDetail;
    if (e.children) stampImageLayerEvidence(e.children, evidenceDetail);
  }
}

/**
 * Queries `{registry}/v2/{repo}/referrers/{digest}` and downloads the first
 * parseable CycloneDX/SPDX attestation. Returns null when the index has no
 * SBOM; throws with `.status` on HTTP failures (the caller maps markers).
 */
export async function fetchReferrersBom(
  ref: ParsedImageRef,
): Promise<{ entries: DiscoveredBomEntry[]; edges: SpdxEdge[] } | null> {
  const client = makeRegistryClient(ref.registry);
  const base = `https://${ref.registry}/v2/${ref.repository}`;
  const index = (await client.getJson(
    `${base}/referrers/${ref.digest}`,
    "application/vnd.oci.image.index.v1+json",
  )) as { manifests?: { digest?: string; artifactType?: string }[] };

  for (const m of index.manifests ?? []) {
    if (!m.digest) continue;
    if (
      m.artifactType &&
      !SBOM_ARTIFACT_TYPES.some(
        (t) => m.artifactType!.includes(t.split("/")[1]!.split("+")[0]!),
      )
    ) {
      continue;
    }
    const manifest = (await client.getJson(
      `${base}/manifests/${m.digest}`,
      "application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json",
    )) as { layers?: { digest?: string }[] };
    for (const layer of manifest.layers ?? []) {
      if (!layer.digest) continue;
      const blob = (await client.getJson(
        `${base}/blobs/${layer.digest}`,
      )) as Record<string, unknown>;
      const doc = detectSbomDoc(blob);
      if (doc) {
        const parsed = parseDoc(doc);
        // Spec 078 — `edges` rides with `entries`: both are absent
        // together so field presence keeps its authority meaning.
        if (parsed.entries.length) {
          return { entries: parsed.entries, edges: parsed.edges };
        }
      }
    }
  }
  return null;
}

/**
 * Resolves the SBOM for one image digest ref (`repo@sha256:…`). Returns
 * `entries` undefined when no attestation exists — the caller omits
 * `bomEntries` and records the marker (FR-004/FR-018).
 */
export async function fetchImageBom(
  repoDigest: string,
): Promise<ImageBomResult> {
  const ref = parseRepoDigest(repoDigest);
  if (!ref) {
    return {
      marker: {
        status: "UNAVAILABLE",
        message: "image has no resolvable registry digest",
      },
    };
  }
  const evidenceDetail = `referrers:${ref.repository}@${ref.digest}`;
  try {
    const bom = await fetchReferrersBom(ref);
    if (bom) {
      stampImageLayerEvidence(bom.entries, evidenceDetail);
      return { entries: bom.entries, edges: bom.edges, marker: { status: "OK" } };
    }
    return {
      marker: {
        status: "UNAVAILABLE",
        message: "no SBOM attestation in registry referrers",
      },
    };
  } catch (err) {
    const status = (err as { status?: number }).status;
    return {
      marker: {
        status:
          status === 401 || status === 403
            ? "FORBIDDEN"
            : status === 404
              ? "UNAVAILABLE"
              : "ERROR",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}
