/**
 * Wiring registry for the v1.1.0 UX baseline (spec 029). One entry per
 * detail route: `fixture` records which prototype fixture the surface was
 * ported from (historical), `read` is the endpoint behind the TanStack
 * Query hook, `mutations` lists every mutation control, and `gap` records
 * anything the design shows that the backend does not expose yet
 * (tracked in researches/ux-rewrite-gaps.md).
 */
export interface Mutation {
  control: string
  call: string
  note?: string
}

export interface WiringEntry {
  route: string
  file: string
  param: string
  fixture: string
  read: string[]
  mutations: Mutation[]
  tabs?: string[]
  gap?: string
}

export const WIRING: WiringEntry[] = [
  {
    route: "/users/[id]",
    file: "components/admin/user-detail.tsx",
    param: "id (user id)",
    fixture: "users, sessions (filtered by username), auditEvents (filtered by actor)",
    read: ["GET /users/:id", "GET /users/:id/sessions", "GET /audit?actor=:username"],
    tabs: ["overview", "sessions", "activity"],
    mutations: [
      { control: "Save role", call: "PATCH /users/:id { role }", note: "Disabled for the signed-in user; the API must also reject self role changes." },
      { control: "Deactivate / Reactivate", call: "PATCH /users/:id { isActive }", note: "Deactivating must end all sessions server-side." },
      { control: "Revoke session", call: "POST /sessions/:id/revoke" },
      { control: "Send password reset", call: "POST /auth/password/reset", note: "Admin generates a one-time token for copy-out." },
    ],
    gap: "Resolved: POST /auth/password/reset exists (admin token generation). Audit supports actor filtering.",
  },
  {
    route: "/credentials/[id]",
    file: "components/admin/credential-detail.tsx",
    param: "id (credential id)",
    fixture: "credentials, importers (filtered by credentialLabel === slug), auditEvents",
    read: ["GET /credentials/:id", "GET /importers?credentialId=:id", "GET /audit?entityKind=credential&entityId=:id"],
    tabs: ["overview", "usage", "activity"],
    mutations: [
      { control: "Test connection", call: "POST /credentials/:id/test" },
      { control: "Rotate secret", call: "PATCH /credentials/:id { secrets|secretRefMap }", note: "Rotate form re-keys existing secret names." },
      { control: "Revoke", call: "PATCH /credentials/:id { status: 'REVOKED' }" },
      { control: "Delete", call: "DELETE /credentials/:id", note: "Blocked in the UI while importers use it; the API should return 409." },
    ],
    gap: "Resolved: usage reads GET /credentials/:id dependents.importerConfigs — no filter needed (gap G6).",
  },
  {
    route: "/component-groups/[slug]",
    file: "app/(app)/component-groups/[slug]/page.tsx",
    param: "slug",
    fixture: "componentGroups, components (filtered by componentGroupName), teams",
    read: ["GET /component-groups/:id", "GET /components?componentGroupId=:id"],
    mutations: [
      { control: "Edit group", call: "PATCH /component-groups/:id", note: "Dialog not built." },
      { control: "Delete group", call: "DELETE /component-groups/:id", note: "Members become ungrouped." },
    ],
    gap: "The API addresses groups by id; resolve slug to id or add a slug lookup.",
  },
  {
    route: "/teams/[slug]",
    file: "app/(app)/teams/[slug]/page.tsx",
    param: "slug",
    fixture: "teams, products (teamOwnerName), components (teamOwnerName), componentGroups",
    read: ["GET /teams/:id (not exposed)", "GET /products?teamId=:id", "GET /components?teamId=:id"],
    mutations: [
      { control: "Edit team", call: "PATCH /teams/:id", note: "Dialog not built." },
      { control: "Delete team", call: "DELETE /teams/:id", note: "Blocked while it owns products or components." },
    ],
    gap: "No GET /teams/:id — the detail resolves from the filtered list. PATCH/DELETE exist (gap G7).",
  },
  {
    route: "/lobs/[slug]",
    file: "app/(app)/lobs/[slug]/page.tsx",
    param: "slug",
    fixture: "lobs, teams (lob name), products (lobOwnerName)",
    read: ["GET /lobs/:id (not exposed)", "GET /teams?lobId=:id", "GET /products?lobId=:id"],
    mutations: [
      { control: "Edit line of business", call: "PATCH /lobs/:id", note: "Dialog not built." },
      { control: "Delete line of business", call: "DELETE /lobs/:id", note: "Blocked while it has teams or products." },
    ],
    gap: "No GET /lobs/:id — the detail resolves from the filtered list. PATCH/DELETE exist (gap G8).",
  },
  {
    route: "/agents/[id]",
    file: "components/agents/agent-detail.tsx",
    param: "id",
    fixture: "importAgents, agentSessions, auditEvents",
    read: ["GET /agents/:id", "GET /agents/:id/sessions", "GET /audit?entityKind=agent"],
    tabs: ["overview", "policy", "sessions", "activity"],
    mutations: [
      { control: "Save policy", call: "PATCH /agents/:id { allowedImporters }" },
      { control: "Rotate / Reissue token", call: "POST /agents/:id/enrollment-token", note: "Token is returned once." },
      { control: "Revoke credential", call: "POST /agents/:id/revoke" },
      { control: "Delete agent", call: "DELETE /agents/:id", note: "Blocked while configs are bound." },
    ],
  },
  {
    route: "/importers/[id]",
    file: "components/importers/importer-detail.tsx",
    param: "id",
    fixture: "importers, importRuns",
    read: ["GET /importers/:id", "GET /importers/:id/runs"],
    mutations: [{ control: "Run now, enable, edit, delete", call: "See importer routes in the backend" }],
  },
  {
    route: "/importers/[id]/runs/[runId]",
    file: "components/importers/run-detail.tsx",
    param: "id, runId",
    fixture: "importers, importRuns, runErrors, runChanges",
    read: ["GET /importers/:id/runs", "GET /importers/:id/runs/:runId/errors", "GET /importers/:id/runs/:runId/changes"],
    mutations: [{ control: "Cancel run", call: "Cancel route for an active run; the run keeps its processed assets" }],
  },
  {
    route: "/auth/oidc/callback",
    file: "components/auth/oidc-callback.tsx",
    param: "none (?error=)",
    fixture: "none",
    read: ["GET /api/v1/auth/oidc/callback is handled by the backend, which sets the session and redirects"],
    mutations: [],
  },
  {
    route: "/products/[slug]",
    file: "components/products/product-detail.tsx",
    param: "slug",
    fixture: "products, components",
    read: ["GET /products/:slug"],
    mutations: [{ control: "Edit, delete, link management", call: "See product routes in the backend" }],
  },
  {
    route: "/components/[slug]",
    file: "components/catalog/component-detail.tsx",
    param: "slug",
    fixture: "components",
    read: ["GET /components/:slug"],
    mutations: [{ control: "Edit, retire, delete", call: "See component routes in the backend" }],
  },
  {
    route: "/products/new, /products/[slug]/edit",
    file: "components/products/product-form.tsx",
    param: "slug (edit only)",
    fixture: "products, lobs, teams",
    read: ["GET /products/:slug", "GET /lobs", "GET /teams"],
    mutations: [
      { control: "Create product", call: "POST /products", note: "Slug is generated from the name and locked after creation." },
      { control: "Save changes", call: "PATCH /products/:slug" },
    ],
  },
  {
    route: "/products/import",
    file: "components/products/import-products.tsx",
    param: "none",
    fixture: "none",
    read: [],
    mutations: [{ control: "Import products", call: "Product bulk import route", note: "The prototype validates a pasted file locally; the API must validate and return per-row errors." }],
  },
  {
    route: "/products/[slug]/history, /components/[slug]/history",
    file: "components/patterns/entity-history.tsx",
    param: "slug",
    fixture: "auditEvents (filtered by entityName)",
    read: ["GET /audit?entityKind=product|component&entityId=:id"],
    mutations: [],
  },
  {
    route: "/components/[slug]/promote",
    file: "components/components/promote-form.tsx",
    param: "slug",
    fixture: "components, products, lobs, teams",
    read: ["GET /components/:slug", "GET /components/:slug/dependents"],
    mutations: [{ control: "Promote to platform", call: "POST /components/:id/promote-to-platform", note: "Body is PromoteToPlatformInput; consumerIds are the dependents that become CONSUMES_FROM edges." }],
  },
  {
    route: "/importers/new, /importers/[id]/edit",
    file: "components/importers/importer-form.tsx",
    param: "id (edit only)",
    fixture: "importers, credentials, agents",
    read: ["GET /importers/manifests", "GET /importers/:id", "GET /credentials", "GET /agents"],
    mutations: [
      { control: "Create importer", call: "POST /importers", note: "Scope is rendered from the manifest configSchema; credentialIds replace deprecated secretRefs." },
      { control: "Save changes", call: "PATCH /importers/:id" },
    ],
    gap: "configSchema is a serialized Zod schema — not renderable. Scope is a validated JSON editor until the API exposes field descriptors (gap G13).",
  },
  {
    route: "/credentials/new",
    file: "components/admin/credential-form.tsx",
    param: "none",
    fixture: "credentials",
    read: [],
    mutations: [{ control: "Create credential", call: "POST /credentials", note: "Secret values are write-only. AGENT_MANAGED credentials send references, never values." }],
  },
]

export const WIRING_RULES = [
  "Every surface reads through TanStack Query hooks; no fixture or local-state copies of server data.",
  "Mutations invalidate the read query they feed, keep the success toast, and show the API error message on failure.",
  "`?tab=` is the source of truth for the active tab, validated via useValidatedTab so deep links never render an empty panel.",
  "A `blockedReason` on DangerZone mirrors a server rule. The API enforces it too and returns 409 with the reason.",
  "Reads that 404 render the not-found state; role-restricted routes render the forbidden state via AuthGuard.",
  "Every UI guard is advisory: self role change, self deactivation, last-admin removal and blocked deletes are enforced by the API (403/409) and surfaced verbatim.",
  "Every route is authenticated via AuthGuard; auth pages live outside the shell.",
  "API responses pass through per-entity mappers before reaching components, so session ids, tokens and other internal fields stay off the page.",
  "Enrollment tokens and secrets are minted by the hub and returned once — shown exactly once in the issuing dialog, never persisted in UI state.",
  "Capabilities the backend does not expose are hidden behind flags in ux/lib/flags.ts with a matching entry in researches/ux-rewrite-gaps.md.",
]
