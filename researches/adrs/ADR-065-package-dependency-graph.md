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

## Amendment 1 — Docker importer joins the lockstep set (2026-10-31, via ADR-119)

**Context**: The importer set is enumerated ("all 7 importer packages" —
now 8 with `@componode/importer-alibaba-cloud` per ADR-115), and the
ADR-116 lockstep handshake makes that set a closed surface: hub and Agent
must advertise the identical importer list. The Docker importer program
adds a ninth package, so the set change is ratified here, ahead of the
code.

**Refinement**: `@componode/importer-docker` is admitted to the in-tree
importer set — `packages/backend` and `packages/agent` each gain a
manifest-import dependency on it, keeping the ADR-116 lockstep property.
This is a **contract-first** amendment: it ratifies the set membership;
the package, its registration, and the dependency edits land in the
Docker importer spec. The importer-count language above is corrected to
the current 8 in-tree importers.

**Amended by ADR-119**: `@componode/importer-docker` is admitted to the
hub+agent lockstep importer set contract-first — see Amendment 1.
