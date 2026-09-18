/**
 * API documentation contract test (ADR-104).
 *
 * Registers every route plugin against a recording Fastify instance and
 * verifies that `docs/openapi.yaml` and the generated regions of
 * `docs/api.md` are in sync with the code:
 *
 *  - every registered path+method exists in the spec (and vice versa);
 *  - `x-permission` in the spec equals the tagged `requireRole` permission;
 *  - `security: []` in the spec ⇔ no `verifySession` in the route preHandlers;
 *  - `ERROR_CODES` (core) === the `Error.code` enum in the spec;
 *  - `docs/api.md` equals the generator output for the current spec.
 *
 * Auto-registered HEAD routes are ignored. `GET /metrics` (served outside
 * `/api/v1`) is included explicitly.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import Fastify, { type FastifyInstance, type RouteOptions } from "fastify";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.COOKIE_SECRET ??= "test-secret-test-secret-test-secret";

const API_PREFIX = "/api/v1";
// Sentinel used to detect `app.verifySession` in route preHandler arrays.
const VERIFY_SESSION = async () => {};

interface CollectedRoute {
  method: string;
  path: string; // spec-style path, e.g. /users/{id}
  preHandlers: unknown[];
}

let collected: CollectedRoute[] = [];
let spec: import("../../scripts/generate-api-doc.js").Spec;
let apiMd: string;

function toSpecPath(url: string): { specPath: string; inV1: boolean } {
  if (url.startsWith(API_PREFIX)) {
    const p = url.slice(API_PREFIX.length).replaceAll(/:([A-Za-z_]+)/g, "{$1}");
    return { specPath: p, inV1: true };
  }
  return { specPath: url.replaceAll(/:([A-Za-z_]+)/g, "{$1}"), inV1: false };
}

beforeAll(async () => {
  const [
    { authRoutes },
    { healthRoutes },
    { userRoutes },
    { settingsRoutes },
    { sessionRoutes },
    { importerRoutes },
    { componentRoutes },
    { componentGroupRoutes },
    { dashboardRoutes },
    { searchRoutes },
    { productRoutes },
    { orgRoutes },
    { auditRoutes },
    { metricsRoutes },
    { credentialRoutes },
    { loadSpec, generateApiDoc, API_MD_PATH },
  ] = await Promise.all([
    import("../../src/routes/auth.js"),
    import("../../src/routes/health.js"),
    import("../../src/routes/users.js"),
    import("../../src/routes/settings.js"),
    import("../../src/routes/sessions.js"),
    import("../../src/routes/importers.js"),
    import("../../src/routes/components.js"),
    import("../../src/routes/component-groups.js"),
    import("../../src/routes/dashboard.js"),
    import("../../src/routes/search.js"),
    import("../../src/routes/products.js"),
    import("../../src/routes/org.js"),
    import("../../src/routes/audit.js"),
    import("../../src/routes/metrics.js"),
    import("../../src/routes/credentials.js"),
    import("../../scripts/generate-api-doc.js"),
  ]);

  const raw: RouteOptions[] = [];
  const app: FastifyInstance = Fastify();
  app.addHook("onRoute", (r) => raw.push(r));
  app.decorate("verifySession", VERIFY_SESSION);

  for (const plugin of [
    authRoutes,
    healthRoutes,
    userRoutes,
    settingsRoutes,
    sessionRoutes,
    importerRoutes,
    componentRoutes,
    componentGroupRoutes,
    dashboardRoutes,
    searchRoutes,
    productRoutes,
    orgRoutes,
    auditRoutes,
    credentialRoutes,
  ]) {
    await app.register(plugin, { prefix: API_PREFIX });
  }
  await app.register(metricsRoutes); // no /api/v1 prefix (ADR-069)
  await app.ready();

  collected = raw.flatMap((r) => {
    const methods = Array.isArray(r.method) ? r.method : [r.method];
    const handlers = r.preHandler
      ? Array.isArray(r.preHandler)
        ? r.preHandler
        : [r.preHandler]
      : [];
    const { specPath } = toSpecPath(r.url);
    return methods
      .filter((m) => m !== "HEAD") // auto-registered by Fastify
      .map((m) => ({ method: m, path: specPath, preHandlers: handlers }));
  });

  spec = loadSpec();
  apiMd = readFileSync(API_MD_PATH, "utf-8");
});

function specOperation(path: string, method: string) {
  const methods = spec.paths[path];
  return methods?.[method.toLowerCase()];
}

describe("openapi.yaml route coverage", () => {
  it("documents every registered route (path + method)", () => {
    const missing = collected.filter(
      (r) => specOperation(r.path, r.method) === undefined,
    );
    expect(
      missing,
      `Routes missing from docs/openapi.yaml: ${missing
        .map((r) => `${r.method} ${r.path}`)
        .join(", ")}`,
    ).toEqual([]);
  });

  it("has no spec operations that are not registered", () => {
    const registered = new Set(collected.map((r) => `${r.method} ${r.path}`));
    const extra: string[] = [];
    for (const [path, methods] of Object.entries(spec.paths)) {
      for (const m of Object.keys(methods)) {
        if (!registered.has(`${m.toUpperCase()} ${path}`)) {
          extra.push(`${m.toUpperCase()} ${path}`);
        }
      }
    }
    expect(extra, `Spec operations with no matching route: ${extra.join(", ")}`).toEqual([]);
  });
});

describe("openapi.yaml access annotations", () => {
  it("x-permission matches the tagged requireRole permission", () => {
    const mismatches: string[] = [];
    for (const r of collected) {
      const op = specOperation(r.path, r.method);
      if (!op) continue;
      const tagged = r.preHandlers
        .map((h) => (h as { requiredPermission?: string }).requiredPermission)
        .find((p) => p !== undefined);
      const documented = op["x-permission"];
      if (tagged !== documented) {
        mismatches.push(
          `${r.method} ${r.path}: code=${tagged ?? "(none)"} spec=${documented ?? "(none)"}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });

  it("security: [] in the spec iff the route has no verifySession preHandler", () => {
    const mismatches: string[] = [];
    for (const r of collected) {
      const op = specOperation(r.path, r.method);
      if (!op) continue;
      const isPublic = r.preHandlers.includes(VERIFY_SESSION) === false;
      const specPublic = Array.isArray(op.security) && op.security.length === 0;
      if (isPublic !== specPublic) {
        mismatches.push(
          `${r.method} ${r.path}: ${isPublic ? "public route, spec requires auth" : "authenticated route, spec marks public"}`,
        );
      }
    }
    expect(mismatches).toEqual([]);
  });
});

describe("error codes", () => {
  it("spec Problem.code enum matches ERROR_CODES from @componode/core", async () => {
    const { ERROR_CODES } = await import("@componode/core");
    const specCodes: string[] = spec.components.schemas.Problem.properties.code.enum;
    expect([...specCodes].sort()).toEqual([...ERROR_CODES].sort());
  });
});

describe("docs/api.md generated regions", () => {
  it("is up to date with docs/openapi.yaml", async () => {
    const { generateApiDoc } = await import("../../scripts/generate-api-doc.js");
    expect(generateApiDoc(spec, apiMd)).toEqual(apiMd);
  });
});
