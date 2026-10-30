# Research — 038 UX Conformance

Every unknown in the plan was resolved by direct code inspection. Where a
design choice sits inside ratified boundaries it is recorded here with a
`Ratified in:` anchor instead of an ADR.

## Resolved plan-time verifications

| Question | Finding | Decision |
|---|---|---|
| Importer-card `lastRun` source | `DashboardSummary.lastRuns` already returns `{configId, runId, status, completedAt, assetsProcessed, assetsCreated, assetsUpdated}` (`dashboard-service.ts:269-280`) | **Wire it** — importers page reads `useDashboardSummary` (or the same endpoint) and the mapper joins by `configId`. No new endpoint, no gap entry. Ratified in: `docs/ux.md` mapper rule. |
| Attention component hrefs | Products emit `/products/{slug}` correctly; component rows emit `/components/{id}` (`dashboard-service.ts:194,215`) because the `errorInstances`/`sunsetComponents` selects take `components.name` but not `slug` | **Backend fix** — add `components.slug` to both selects, emit `/components/{slug}`. Smallest correct fix; routes are slug-keyed by prototype convention (ADR-046). |
| `rotateAgent` on `PENDING_ENROLLMENT` | `rotateAgentCredential` (`agent-service.ts:445`) rotates unconditionally — no status gate | **No change needed** — the shipped reissue flow already works. |
| Component-list `includeGone` | Backend supports it (`component-catalog-service.ts:19,58,154`); frontend never sends it | **Frontend fix** — wire the param + opt-in control matching the retired-toggle pattern. |
| Component-groups `lifecycle` | Backend supports the filter (`component-group-service.ts:64-67`); frontend never sends it | **Frontend fix** — wire the param + opt-in. |
| Detail-level GONE | `getComponentById` hard-filters `status != "GONE"` (`component-catalog-service.ts:216`) — no param | **Gap-registered (G26)** — copy corrected to describe actual behavior until the param lands. |
| Register `email` | `POST /auth/register` accepts `username`/`password`/`displayName` only (openapi.yaml:112-128) | **No work-email field** — gap-registered under auth hardening (G27). |

## Fix-site map (from the review evidence)

| Fix | Primary file(s) |
|---|---|
| Attention slug hrefs | `packages/backend/src/services/dashboard-service.ts` (selects ~:125, :194, :215) |
| Password-reset row item | `ux/components/admin/users-table.tsx:138` → `useResetPassword` |
| `replaced` disconnect META | `ux/lib/domain.ts:109` |
| LOB delete guard | `ux/app/lobs/$slug.tsx:69` |
| GONE/RETIRED opt-ins | `ux/app/components/index.tsx`, `ux/app/component-groups/index.tsx`, hooks `useComponents`/`useComponentGroups` |
| Breadcrumbs | `ux/components/app/app-header.tsx:23-35` |
| Convert secrets | `ux/components/importers/importer-detail.tsx` + `api/hooks/importers.ts:95` |
| Slug field error | `ux/components/components/promote-form.tsx` (map `SLUG_TAKEN` → `FieldError`) |
| Feed sentences | `api/mappers/dashboard.ts:79-85` |
| 404 + ErrorBoundary | `src/routes.tsx:121-127`, `src/app.tsx:76-96` → `ErrorState` |
| ForbiddenState | `ux/app/{lobs,component-groups}/$slug.tsx`, `ux/app/users/$id.tsx` |
| Sidebar storage | `ux/ux-shell.tsx:10-19` → sessionStorage; `ux/components/ui/sidebar.tsx:84` dead cookie removed |
| Neutral-enum fallbacks | `api/mappers/operations.ts:110,228`; guards in `patterns/status-badge.tsx`, `patterns/provider-mark.tsx` |
| Security sessions cols | `ux/app/settings/security.tsx:87` |
| Org table columns | `ux/components/org/org-detail.tsx`, `org-tables.tsx` |
| Workspace default-role | `ux/app/settings/workspace.tsx:64` |
| KIND_META / DOT map | `ux/components/admin/credential-form.tsx:17` → `ux/lib/domain.ts`; `ux/components/products/product-map.tsx:19-24` → `HEALTH_META` |
| Command-menu adornments | `ux/components/app/command-menu.tsx` |
| agentIncompatible on detail | `ux/components/importers/importer-detail.tsx` Executor row |
| Header fakes | `ux/components/app/app-header.tsx:66-80` (delete) |
| Auth restorations | `src/pages/{login,register,oidc-callback}.tsx` |
| Credentials alert | `ux/app/credentials/index.tsx` |
| Radius scale | `ux/styles.css` `@theme` block |
| Canvas data | `ux/app/products/$slug.tsx:73`, `ux/components/products/product-map.tsx` |

## Alternatives considered

- **Attention hrefs**: frontend id→slug resolution vs backend slug hrefs —
  chose backend (one select column; keeps route convention server-true,
  avoids a second lookup round-trip in the UI).
- **Canvas relations display**: edge-type labels on the SVG vs a separate
  textual relations card — plan leaves the precise presentation to
  implementation within the canvas (labeled edges preferred for scan-ability;
  a relations legend is acceptable).
- **`lastRun` join site**: page-level join vs API shape change — page-level
  join, since `DashboardSummary.lastRuns` already exists and no new
  endpoint is allowed inside this feature.
