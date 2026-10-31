import type {
  Importer,
  ImporterSecretDeclaration,
} from "./contracts/importer.js";

// Importer registry shared by the hub backend and remote Import Agents
// (ADR-065 amendment; ADR-116). Core is a leaf package: callers inject the
// concrete importer package names, and manifests/impls are loaded lazily via
// dynamic import.
export interface ImporterManifest {
  name: string;
  label: string;
  description: string;
  version: string;
  implPath: string;
  configSchema: unknown;
  // Named secret keys the importer consumes from the resolved `secrets`
  // record; drives save-time coverage validation. Declare only keys the
  // importer actually reads (contracts/credentials-api.md).
  secrets?: ImporterSecretDeclaration[];
  // Names the config-scope key carrying the agent-local `targetId`
  // (ADR-056 A1, ADR-116 A5). Presence means remote execution with
  // agent-registry preflight; absent = no target resolution.
  targetRefKey?: string;
  // Declares this importer calls `context.reportSourceIdentity` before
  // its first asset yield (ADR-056 A2). Absent/false = legacy
  // unattributed provenance until the importer's migration wave.
  reportsSourceIdentity?: boolean;
}

export interface ImporterRegistry {
  getManifests(): Promise<ImporterManifest[]>;
  getManifest(name: string): Promise<ImporterManifest>;
  getImporter(name: string): Promise<Importer>;
  getConfigSchema(name: string): Promise<unknown>;
}

// Dynamic-import loader evaluated in the CALLER's package context — core is
// a leaf and cannot resolve `@componode/importer-*` itself (ADR-065).
export type ModuleLoader = (specifier: string) => Promise<unknown>;

// The in-tree importer package set — single source of truth for the
// lockstep handshake (hub and agent must agree exactly, ADR-116 #7).
export const IMPORTER_PACKAGES = [
  "@componode/importer-github",
  "@componode/importer-aws",
  "@componode/importer-azure",
  "@componode/importer-kubernetes",
  "@componode/importer-web-url",
  "@componode/importer-api-url",
  "@componode/importer-mcp-server",
  "@componode/importer-alibaba-cloud",
];

export function createImporterRegistry(
  packageNames: string[] = IMPORTER_PACKAGES,
  load: ModuleLoader,
  onError?: (pkg: string, err: Error) => void,
): ImporterRegistry {
  const manifestCache = new Map<string, ImporterManifest>();
  const importerCache = new Map<string, Importer>();

  async function getManifests(): Promise<ImporterManifest[]> {
    const manifests: ImporterManifest[] = [];

    for (const pkg of packageNames) {
      if (manifestCache.has(pkg)) {
        manifests.push(manifestCache.get(pkg)!);
        continue;
      }

      try {
        const mod = (await load(`${pkg}/manifest`)) as {
          manifest: ImporterManifest;
        };
        if (mod.manifest) {
          manifestCache.set(pkg, mod.manifest);
          manifests.push(mod.manifest);
        }
      } catch (err) {
        // If the package is not built yet, skip it; callers decide how to
        // surface the failure (no console.* in production paths).
        onError?.(pkg, err as Error);
      }
    }

    return manifests;
  }

  async function getManifest(name: string): Promise<ImporterManifest> {
    const manifests = await getManifests();
    const manifest = manifests.find((m) => m.name === name);
    if (!manifest) {
      throw Object.assign(new Error(`Importer not found: ${name}`), {
        statusCode: 404,
        code: "NOT_FOUND",
      });
    }
    return manifest;
  }

  async function getImporter(name: string): Promise<Importer> {
    if (importerCache.has(name)) {
      return importerCache.get(name)!;
    }

    const manifest = await getManifest(name);
    const mod = (await load(manifest.implPath)) as Record<string, unknown>;

    // Derive the named class from the importer name (e.g., "web-url" -> "WebUrlImporter").
    const className =
      name
        .split("-")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join("") + "Importer";

    // Support both named and default exports of the importer class.
    const ImporterClass =
      mod[className] ?? (mod as { default?: unknown }).default;
    if (!ImporterClass || typeof ImporterClass !== "function") {
      throw new Error(`Importer ${name} does not export a valid class`);
    }

    const instance = new (ImporterClass as new () => Importer)();
    if (instance.name !== name) {
      throw new Error(
        `Importer class name mismatch: expected ${name}, got ${instance.name}`,
      );
    }

    importerCache.set(name, instance);
    return instance;
  }

  async function getConfigSchema(name: string): Promise<unknown> {
    const manifest = await getManifest(name);
    return manifest.configSchema;
  }

  return { getManifests, getManifest, getImporter, getConfigSchema };
}
