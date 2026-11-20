import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  fetchImageBom as fetchReferrersImageBom,
  parseCycloneDxDocument,
  parseRepoDigest,
  stampImageLayerEvidence,
  type DiscoveredBomEntry,
  type ImageBomResult,
} from "@componode/core";

const execFileAsync = promisify(execFile);

export { parseRepoDigest };
export type { BomCapabilityMarker, ImageBomResult } from "@componode/core";

// Spec 073 / FR-015 — image SBOM attestations via OCI Referrers (the shared
// client lives in @componode/core — importer-kubernetes uses it too) with
// the research's Syft subprocess fallback: when referrers produce nothing,
// `syft registry:<repo>@<digest>` resolves auth through the host's docker
// config — the importer itself never handles registry credentials
// (ADR-107). No Syft on PATH → the referrers marker stands.

async function fetchSyftBom(
  repoDigest: string,
): Promise<DiscoveredBomEntry[] | null> {
  const ref = parseRepoDigest(repoDigest);
  if (!ref) return null;
  const { stdout } = await execFileAsync(
    process.env.COMPONODE_SYFT_PATH ?? "syft",
    [`registry:${ref.repository}@${ref.digest}`, "-o", "cyclonedx-json"],
    { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 },
  );
  const doc = JSON.parse(stdout) as Record<string, unknown>;
  if (doc.bomFormat !== "CycloneDX") return null;
  const parsed = parseCycloneDxDocument(
    doc as Parameters<typeof parseCycloneDxDocument>[0],
  ).entries;
  if (!parsed.length) return null;
  stampImageLayerEvidence(parsed, `syft:${repoDigest}`);
  return parsed;
}

/**
 * Resolves the SBOM for one image digest. Referrers first, Syft second —
 * `entries` stays undefined when neither produced inventory so the caller
 * omits `bomEntries` and records the marker (FR-004/FR-018).
 */
export async function fetchImageBom(
  repoDigest: string,
  opts: { imageRef?: string; syft?: boolean } = {},
): Promise<ImageBomResult> {
  const result = await fetchReferrersImageBom(repoDigest);
  if (result.entries) return result;
  if (opts.syft === false) return result;
  try {
    const fallback = await fetchSyftBom(repoDigest);
    if (fallback) return { entries: fallback, marker: { status: "OK" } };
  } catch {
    // Syft missing or failed — the referrers marker already names the cause.
  }
  return result;
}
