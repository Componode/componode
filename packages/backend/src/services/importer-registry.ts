import type { Importer, ImporterSecretDeclaration } from "@componode/core";

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
}

const IMPORTER_PACKAGES = [
  "@componode/importer-github",
  "@componode/importer-aws",
  "@componode/importer-azure",
  "@componode/importer-kubernetes",
  "@componode/importer-web-url",
  "@componode/importer-api-url",
  "@componode/importer-mcp-server",
];

const manifestCache = new Map<string, ImporterManifest>();
const importerCache = new Map<string, Importer>();

export async function getManifests(): Promise<ImporterManifest[]> {
  const manifests: ImporterManifest[] = [];

  for (const pkg of IMPORTER_PACKAGES) {
    if (manifestCache.has(pkg)) {
      manifests.push(manifestCache.get(pkg)!);
      continue;
    }

    try {
      const mod = (await import(`${pkg}/manifest`)) as { manifest: ImporterManifest };
      if (mod.manifest) {
        manifestCache.set(pkg, mod.manifest);
        manifests.push(mod.manifest);
      }
    } catch (err) {
      // If the package is not built yet, skip it and log a warning.
      console.warn(`Failed to load importer manifest from ${pkg}:`, (err as Error).message);
    }
  }

  return manifests;
}

export async function getManifest(name: string): Promise<ImporterManifest> {
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

export async function getImporter(name: string): Promise<Importer> {
  if (importerCache.has(name)) {
    return importerCache.get(name)!;
  }

  const manifest = await getManifest(name);
  const mod = (await import(manifest.implPath)) as Record<string, unknown>;

  // Derive the named class from the importer name (e.g., "web-url" -> "WebUrlImporter").
  const className = name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("") + "Importer";

  // Support both named and default exports of the importer class.
  const ImporterClass = mod[className] ?? (mod as { default?: unknown }).default;
  if (!ImporterClass || typeof ImporterClass !== "function") {
    throw new Error(`Importer ${name} does not export a valid class`);
  }

  const instance = new (ImporterClass as new () => Importer)();
  if (instance.name !== name) {
    throw new Error(`Importer class name mismatch: expected ${name}, got ${instance.name}`);
  }

  importerCache.set(name, instance);
  return instance;
}

export async function getConfigSchema(name: string): Promise<unknown> {
  const manifest = await getManifest(name);
  return manifest.configSchema;
}
