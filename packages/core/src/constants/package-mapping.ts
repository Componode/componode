import type { ComponentCategory } from "./component-categories.js";
import type { ComponentProvider } from "./component-providers.js";
import { parsePurl } from "../utils/purl.js";
import { slugify } from "../utils/slug.js";

// Spec 075 / ADR-013 Amendment 2 — the promotion mapping tables used when a
// BOM entry becomes a Library component. Single-sourced here so the preview
// endpoint and the create path can never disagree.

const ECOSYSTEM_TO_PROVIDER: Record<string, ComponentProvider> = {
  npm: "NPM",
  pypi: "PYPI",
  maven: "MAVEN",
  nuget: "NUGET",
  golang: "GOLANG",
  cargo: "CARGO",
  gem: "RUBYGEMS",
  composer: "PACKAGIST",
  deb: "DEBIAN",
  rpm: "RPM",
  apk: "ALPINE",
};

/**
 * Registry hostname → container provider for `docker`/`oci` ecosystems.
 * GHCR and ECR are identified from the purl's registry host; anything else
 * falls back to `DOCKER`.
 */
function containerProvider(registryHost: string | null): ComponentProvider {
  if (!registryHost) return "DOCKER";
  const host = registryHost.toLowerCase();
  if (host === "ghcr.io") return "GHCR";
  if (host.endsWith(".amazonaws.com") && host.includes(".ecr.")) return "ECR";
  return "DOCKER";
}

/** Extract the registry host from a docker/oci purl, when determinable. */
function registryHost(purl: string | null | undefined): string | null {
  const parsed = purl ? parsePurl(purl) : null;
  if (!parsed) return null;
  const repoUrl = parsed.qualifiers?.["repository_url"];
  if (repoUrl) {
    const m = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/:]+)/.exec(repoUrl);
    if (m?.[1]) return m[1];
    const bare = /^([^/:]+)/.exec(repoUrl);
    if (bare?.[1]) return bare[1];
  }
  const firstNs = parsed.namespace?.split("/")[0];
  if (firstNs && firstNs.includes(".")) return firstNs;
  return null;
}

/**
 * `ecosystem` (purl type, stored verbatim on `bom_entries.ecosystem`) →
 * `ComponentProvider`. `purl` is needed for docker/oci registry resolution;
 * unmapped ecosystems return `OTHER`.
 */
export function mapEcosystemToProvider(
  ecosystem: string,
  purl?: string | null,
): ComponentProvider {
  const normalized = ecosystem.toLowerCase();
  if (normalized === "docker" || normalized === "oci") {
    return containerProvider(registryHost(purl));
  }
  return ECOSYSTEM_TO_PROVIDER[normalized] ?? "OTHER";
}

const CDX_TYPE_TO_CATEGORY: Record<string, ComponentCategory> = {
  library: "LIBRARY",
  framework: "LIBRARY",
  "machine-learning-model": "LIBRARY",
  container: "CONTAINER",
  device: "COMPUTE",
  firmware: "COMPUTE",
  "operating-system": "COMPUTE",
  platform: "COMPUTE",
  application: "COMPUTE",
  service: "API",
  file: "STORAGE",
  data: "STORAGE",
};

/**
 * `cdxType` (CycloneDX component type on `bom_entries.cdxType`) →
 * `ComponentCategory`. Unknown/absent types default to `LIBRARY` — the
 * promotion surface exists for packages.
 */
export function mapCdxTypeToCategory(
  cdxType: string | null | undefined,
): ComponentCategory {
  if (!cdxType) return "LIBRARY";
  return CDX_TYPE_TO_CATEGORY[cdxType.toLowerCase()] ?? "LIBRARY";
}

/**
 * Non-`library`/`framework` inferences and unmapped ecosystems are lossy —
 * the Add-to-catalog dialog surfaces them as a muted "Mapped from {x}" note
 * (UX-ADD-07). Returns the note data or null on a clean mapping.
 */
export function mappingNote(
  cdxType: string | null | undefined,
  ecosystem: string,
): { cdxType: string | null; ecosystem: string } | null {
  const lossyCdx =
    cdxType != null &&
    cdxType.toLowerCase() !== "library" &&
    cdxType.toLowerCase() !== "framework";
  const unmappedEcosystem =
    ECOSYSTEM_TO_PROVIDER[ecosystem.toLowerCase()] === undefined &&
    ecosystem.toLowerCase() !== "docker" &&
    ecosystem.toLowerCase() !== "oci";
  if (!lossyCdx && !unmappedEcosystem) return null;
  return { cdxType: cdxType ?? null, ecosystem };
}

/** Slug token for a package name — `@scope/name` → `scope-name` (ADR-046). */
export function packageSlugToken(name: string): string {
  return slugify(name);
}
