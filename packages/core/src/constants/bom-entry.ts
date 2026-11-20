// Dependency scope — maps to CycloneDX component.scope and SPDX relationship types
export const BOM_DEPENDENCY_SCOPES = [
  "RUNTIME", // required at runtime; CycloneDX "required"; SPDX RUNTIME_DEPENDENCY_OF
  "DEV", // development-only; SPDX DEV_DEPENDENCY_OF
  "BUILD", // build-time only; SPDX BUILD_DEPENDENCY_OF
  "TEST", // test execution only; SPDX TEST_DEPENDENCY_OF
  "SYSTEM", // OS-level: kernel module, firmware, OS library
  "OPTIONAL", // declared optional; CycloneDX "optional"; SPDX OPTIONAL_DEPENDENCY_OF
  "BUNDLED", // vendored / embedded; SPDX DYNAMIC_LINK or STATIC_LINK
  "TRANSITIVE", // indirect, not declared directly by subject
] as const;

export type BomDependencyScope = typeof BOM_DEPENDENCY_SCOPES[number];

export const BOM_DEPENDENCY_SCOPE_META: Record<
  BomDependencyScope,
  { label: string; description: string }
> = {
  RUNTIME: { label: "Runtime", description: "Required when the component runs" },
  DEV: { label: "Dev", description: "Used only during development" },
  BUILD: { label: "Build", description: "Used only during the build" },
  TEST: { label: "Test", description: "Used only during test execution" },
  SYSTEM: {
    label: "System",
    description: "Installed in the operating system layer of the image, not by a language package manager",
  },
  OPTIONAL: { label: "Optional", description: "Declared optional by the package manifest" },
  BUNDLED: {
    label: "Bundled",
    description: "Vendored or embedded in the component rather than installed separately",
  },
  TRANSITIVE: {
    label: "Transitive",
    description: "Pulled in by another package rather than declared directly",
  },
};

// How the entry was detected
export const BOM_EVIDENCE_SOURCES = [
  "LOCK_FILE", // package-lock.json, Pipfile.lock, go.sum, Cargo.lock, etc.
  "MANIFEST_FILE", // package.json, requirements.txt, pom.xml, etc.
  "SBOM_DOCUMENT", // ingested CycloneDX or SPDX document
  "IMAGE_LAYER", // extracted from container image layer (Syft/Trivy/OCI Referrers)
  "REGISTRY_API", // fetched from a package registry API (GitHub dep graph, etc.)
  "VCS_ANALYSIS", // inferred from repository file analysis
] as const;

export type BomEvidenceSource = typeof BOM_EVIDENCE_SOURCES[number];

export const BOM_EVIDENCE_SOURCE_META: Record<
  BomEvidenceSource,
  { label: string; description: string }
> = {
  LOCK_FILE: { label: "Lockfile", description: "Found in a package-manager lockfile" },
  MANIFEST_FILE: { label: "Manifest", description: "Found in a package manifest" },
  SBOM_DOCUMENT: { label: "SBOM file", description: "Imported from a CycloneDX or SPDX document" },
  IMAGE_LAYER: { label: "Image layer", description: "Extracted from a container image layer" },
  REGISTRY_API: { label: "Registry", description: "Reported by a registry or dependency-graph API" },
  VCS_ANALYSIS: { label: "Repository analysis", description: "Inferred from repository files" },
};

// CycloneDX component.type values — stored for round-trip fidelity; drives
// ComponentCategory when a bom_entry is promoted to a full Component (Phase 2)
export const BOM_CDX_TYPES = [
  "library",
  "framework",
  "container",
  "device",
  "firmware",
  "file",
  "machine-learning-model",
  "data",
  "operating-system",
  "platform",
  "application",
  "service",
] as const;

export type BomCdxType = typeof BOM_CDX_TYPES[number];
