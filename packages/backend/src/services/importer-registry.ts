import { createImporterRegistry, IMPORTER_PACKAGES } from "@componode/core";
import { logger } from "../plugins/logging.js";

// Backend-owned registry instance (ADR-065 amendment, spec 025): core owns
// the loader and the package list (single source for the lockstep
// handshake); the backend injects its module loader and re-exports the same
// functions so existing call sites and test mocks are unchanged.
export { IMPORTER_PACKAGES };

// `import()` here resolves relative to THIS package (backend's deps include
// all importer packages); core cannot resolve them on its own.
const registry = createImporterRegistry(
  IMPORTER_PACKAGES,
  (spec) => import(spec),
  (pkg, err) =>
    logger.warn({ err: err.message, pkg }, "failed to load importer manifest"),
);

export const { getManifests, getManifest, getImporter, getConfigSchema } =
  registry;
