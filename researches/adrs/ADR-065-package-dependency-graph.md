### ADR-065 — Package dependency graph

> **Status:** Ratified

**Context**: [ADR-012](./ADR-012-repo-structure-pnpm-monorepo-with-workspaces.md) defined the layout. What are the exact dependency edges?

**Decision**: **`packages/core` is the leaf (zero deps on other `@componode/*`
packages).** Importers depend on `core` only (NOT `backend`, NOT each other —
enforced by ESLint `no-restricted-imports`). `packages/backend` depends on
`core` + all 7 importer packages (manifest import per [ADR-041](./ADR-041-importer-registry-discovery.md)).
`packages/frontend` depends on `core` (types only) — NOT `backend` (calls via
HTTP). Frontend serving: **one container** — the backend serves the frontend's
built static assets via `fastify-static` in production; the frontend runs its
own Vite dev server in dev with an API proxy.

**Rationale**: `core` as the leaf is the seam that keeps importers uniform.
The ESLint boundary rule (importers MUST NOT import `backend`) is enforceable
only if `core` is the sole shared dep. One container (backend serves
frontend) matches [ADR-028](./ADR-028-deployment-docker-compose-only-for-v1.md)'s minimalism (Docker Compose = `postgres` + `app`);
a separate nginx container is an additive change later if needed.

---

**Amended by ADR-116**: `packages/agent` joins backend as a permitted
importer-package aggregator (manifest import only); `importer-registry`
moves to `packages/core` as an injected-package-list factory so `core`
remains a leaf with zero `@componode/*` deps.