# Wiring Contract: Route ↔ Endpoint ↔ Mutation Matrix

Ported from `v0-componode-dpam/lib/wiring.ts` (`@9b040bc`) to React Router
paths under the staged `/ux` prefix. One row per route; `gap` marks surfaces
flagged per FR-016 with a matching entry in `researches/ux-rewrite-gaps.md`.
Execution order follows the spec's story priorities; the prototype's
route-order guidance applies inside each phase.

| Staged route | Prototype source file | Param | Read endpoints | Mutations | Tabs | Gap |
|---|---|---|---|---|---|---|
| `/ux/users/:id` | `components/admin/user-detail.tsx` | id | `GET /users/:id`, `GET /users/:id/sessions`, `GET /audit?actor=:username` | `PATCH /users/:id {role}` (self-change → API 403), `PATCH /users/:id {isActive}` (ends sessions server-side), `POST /sessions/:id/revoke`, `POST /users/:id/password-reset` | overview, sessions, activity | Password reset endpoint missing; confirm audit `actor` param |
| `/ux/credentials/:id` | `components/admin/credential-detail.tsx` | id | `GET /credentials/:id`, `GET /importers?credentialId=:id`, `GET /audit?entityKind=credential&entityId=:id` | `POST /credentials/:id/test`, `PATCH /credentials/:id {secret}` (rotate form TBD), `PATCH /credentials/:id {status:REVOKED}`, `DELETE /credentials/:id` (409 while in use) | overview, usage, activity | `credentialId` filter on `GET /importers` |
| `/ux/component-groups/:slug` | `component-groups/[slug]/page.tsx` | slug | `GET /component-groups/:id`, `GET /components?componentGroupId=:id` | `PATCH /component-groups/:id` (dialog TBD), `DELETE /component-groups/:id` (members ungrouped) | — | Slug→id resolution or slug lookup endpoint |
| `/ux/teams/:slug` | `teams/[slug]/page.tsx` | slug | `GET /teams/:id` (missing), `GET /products?teamId=:id`, `GET /components?teamId=:id` | `PATCH /teams/:id`, `DELETE /teams/:id` (blocked while owning) | — | Detail/edit/delete endpoints missing; list-only today |
| `/ux/lobs/:slug` | `lobs/[slug]/page.tsx` | slug | `GET /lobs/:id` (missing), `GET /teams?lobId=:id`, `GET /products?lobId=:id` | `PATCH /lobs/:id`, `DELETE /lobs/:id` (blocked while owning) | — | Detail/edit/delete endpoints missing; list-only today |
| `/ux/agents/:id` | `components/agents/agent-detail.tsx` | id | `GET /agents/:id`, `GET /agents/:id/sessions`, `GET /audit?entityKind=agent` | `PATCH /agents/:id {allowedImporters}`, `POST /agents/:id/enrollment-token` (shown once), `POST /agents/:id/revoke`, `DELETE /agents/:id` (blocked while bound) | overview, policy, sessions, activity | — |
| `/ux/importers/:id` | `components/importers/importer-detail.tsx` | id | `GET /importers/:id`, `GET /importers/:id/runs` | run-now, enable, edit, delete per backend routes | — | History chart needs per-day aggregates |
| `/ux/importers/:id/runs/:runId` | `components/importers/run-detail.tsx` | id, runId | `GET /importers/:id/runs`, `GET /importers/:id/runs/:runId/errors`, `GET /importers/:id/runs/:runId/changes` | Cancel active run (keeps processed assets) | — | Run change feed endpoint missing |
| `/auth/oidc/callback` (in place) | `components/auth/oidc-callback.tsx` | `?error=` | Backend handles callback, sets session, redirects | — | — | — |
| `/ux/products/:slug` | `components/products/product-detail.tsx` | slug | `GET /products/:slug` | edit, delete, link management per product routes | — | — |
| `/ux/components/:slug` | `components/catalog/component-detail.tsx` | slug | `GET /components/:slug` | edit, retire, delete per component routes | — | — |
| `/ux/products/new`, `/ux/products/:slug/edit` | `components/products/product-form.tsx` | slug (edit) | `GET /products/:slug`, `GET /lobs`, `GET /teams` | `POST /products` (slug from name, locked), `PATCH /products/:slug` | — | — |
| `/ux/products/import` | `components/products/import-products.tsx` | — | — | Product bulk import route; API validates, returns per-row errors | — | Confirm bulk-import endpoint exists |
| `/ux/products/:slug/history`, `/ux/components/:slug/history` | `components/patterns/entity-history.tsx` | slug | `GET /audit?entityKind=product\|component&entityId=:id` | — | — | — |
| `/ux/components/:slug/promote` | `components/components/promote-form.tsx` | slug | `GET /components/:slug`, `GET /components/:slug/dependents` | `POST /components/:id/promote-to-platform` (`PromoteToPlatformInput`; consumerIds → CONSUMES_FROM) | — | Confirm dependents endpoint exists |
| `/ux/importers/new`, `/ux/importers/:id/edit` | `components/importers/importer-form.tsx` | id (edit) | `GET /importers/manifests`, `GET /importers/:id`, `GET /credentials`, `GET /agents` | `POST /importers` (scope from `configSchema`; `credentialIds`), `PATCH /importers/:id` | — | Scope fields must render from manifest, not hardcoded |
| `/ux/credentials/new` | `components/admin/credential-form.tsx` | — | — | `POST /credentials` (write-only secrets; AGENT_MANAGED sends refs) | — | — |

## List & shell surfaces (wired during their story's phase)

Dashboard, products list, components list, component-groups list, importers
list, agents list, credentials list, users list, sessions list, teams list,
lobs list, activity, suggestions queue, settings section (profile,
appearance, authentication, security, session-policy, notifications,
workspace, advanced), `/ux/standards` + `/ux/standards/wiring`,
`/ux/design-system`.

## Invariants (from `WIRING_RULES`, binding on every route)

1. Fixture import → read hook; pass result to the client component as
   `initial`-style props.
2. No local `useState` copies of server data — mutation hooks + query
   invalidation.
3. Success toast kept; API error message shown on failure.
4. `?tab=` is source of truth; unknown falls back to first tab.
5. `blockedReason` on DangerZone mirrors a server rule enforced as 409.
6. 404 read → not-found state.
7. All UI guards advisory — API enforces 403/409 (self role change,
   self-deactivation, last-admin removal, blocked deletes).
8. Real session replaces the prototype stub; every `/ux` route sits behind
   `authed`.
9. Responses mapped to display fields only — ids/tokens/session internals
   never reach the browser.
10. Enrollment tokens/secrets minted by the hub, shown once; remove
    `generateEnrollmentToken()`, the login stub, `SessionProvider.setRole`,
    and `<your-hub-host>` placeholders.
