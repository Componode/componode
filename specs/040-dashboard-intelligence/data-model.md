# Data Model: Dashboard Intelligence

No migrations — every field is computed or already-stored data surfaced on
existing read payloads.

## `DashboardSummary` (extended — `packages/backend/src/services/dashboard-service.ts`, `packages/frontend/src/api/types.ts`)

```ts
interface DashboardSummary {
  counts: { products; components; instances };   // unchanged
  deltas: {                                      // NEW
    products: number;    // digital_products createdAt >= now-7d (all rows)
    components: number;  // components createdAt >= now-7d, lifecycle='ACTIVE'
    instances: number;   // component_instances createdAt >= now-7d, status!='GONE'
  };
  lastImportAt: string | null;
  attention: AttentionItem[];   // extended below
  lastRuns: ImporterRunStatusRow[];
  coverage: CatalogCoverage;
}
```

## `AttentionItem` (extended)

```ts
interface AttentionItem {
  kind:
    | "FAILED_RUN"
    | "PRODUCT_ERROR"
    | "INSTANCE_ERROR"
    | "INSTANCE_GONE"
    | "OFFLINE_AGENT"
    | "CREDENTIAL_EXPIRING"          // NEW — warning tone
    | "SUNSET_OVERDUE_PRODUCT"
    | "SUNSET_OVERDUE_COMPONENT";
  label: string;
  detail: string | null;           // NEW — server-composed context line
  href: string;
  at: string;
}
```

Merge order (front → back, capped at `ATTENTION_LIMIT = 20`):
FAILED_RUN → PRODUCT_ERROR → INSTANCE_ERROR/GONE → OFFLINE_AGENT →
**CREDENTIAL_EXPIRING** (asc `expiresAt`) → SUNSET_OVERDUE_*.

`CREDENTIAL_EXPIRING` row: `label` = credential label,
`href` = `/credentials/{id}`, `at` = `expiresAt`,
`detail` = expiry distance (e.g. "Expires in 3d" / "Expired 2d ago").

`detail` per kind (server-composed, null when nothing to add):
FAILED_RUN → `errorType`/`errorMessage` summary; OFFLINE_AGENT →
last-contact + disconnectReason; INSTANCE_* → status + last-seen;
CREDENTIAL_EXPIRING → expiry distance; PRODUCT_ERROR/SUNSET_* → optional.

## `ImportAgent` (core contract extended — `packages/core/src/contracts/import-agent.ts`)

```ts
interface ImportAgent {
  // …existing fields…
  createdBy: string | null;              // NEW — persons COALESCE(displayName, username)
  enrollmentExpiresAt: string | null;    // NEW — live pending-token expiry, else null
}
```

Both populated by `toApi` for list + detail reads (createdBy via a
`LEFT JOIN persons` on `import_agents.createdBy`; enrollmentExpiresAt
from `enrollmentTokenExpiresAt` gated on the existing `pendingEnrollment`
predicate).

## Frontend view types (already shaped — wiring only)

`AttentionEntry.detail: string | null` and `ImportAgent.createdBy` /
`enrollmentExpiresAt` already exist in `ux/lib/view-types.ts`; mappers
currently stub them. `StatGridDeltas` already declares the three keys.
