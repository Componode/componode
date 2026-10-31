# Research: Dashboard Intelligence

All plan-time verifications resolved by direct code inspection:

1. **Delta computation**: `createdAt` exists on `digital_products`,
   `components`, and `component_instances` — three grouped count queries
   (`createdAt >= now - 7 days`), each scoped to its headline population:
   - products: all rows (the existing `productsTotal` applies no lifecycle
     filter — the delta mirrors it);
   - components: `lifecycle = 'ACTIVE'` (mirrors `componentsTotal`);
   - instances: `status != 'GONE'` (mirrors `instancesTotal`).
   Result shape: `deltas: { products, components, instances }` — all
   non-negative integers, `0` is a real value.

2. **`detail` data availability** — every kind has context already fetched
   or one column away (no N+1):
   - `FAILED_RUN`: `import_runs.errorType`/`errorMessage` already on the
     row — add them to the existing select (dashboard-service.ts:105).
   - `PRODUCT_ERROR`: `computeHealthForProducts` output may carry reasons;
     `detail: null` is acceptable when it doesn't.
   - `INSTANCE_ERROR`/`INSTANCE_GONE`: `status` + `lastSeenAt` already
     selected — detail conveys status + last-seen.
   - `OFFLINE_AGENT`: add `import_agents.lastSeenAt` to the select and
     fetch most-recent `disconnectReason` — the DISTINCT ON pattern in
     `agent-service.ts` (`lastDisconnectReasons`) is the established shape.
   - `SUNSET_OVERDUE_*`: `sunsetAt` already selected — detail can convey
     days overdue (optional; null acceptable).
   - `CREDENTIAL_EXPIRING`: `credentials.expiresAt` — detail conveys
     "expired" vs "expires in Nd".

3. **`CREDENTIAL_EXPIRING` emission**: `credentials.expiresAt` non-null and
   `<= now + 30 days` (30-day window = the G5 credentials-table
   convention). Already-expired rows included. `href: /credentials/{id}`
   (id form matches existing UX links); `at: expiresAt`. Warning tone —
   the frontend `DESTRUCTIVE_KINDS` set is untouched. Ranked below
   OFFLINE_AGENT, above the sunset items (ADR-116 precedent), ordered
   among themselves by soonest `expiresAt`.

4. **ADR fidelity on the kind enum**: `AttentionItem.kind` is an
   enumerated contract surface in `docs/openapi.yaml`. Its only ADR
   ratification is ADR-116's `OFFLINE_AGENT` bullet — the mechanism and
   ranking rule live there. Decision: append **Amendment 4** to ADR-116
   ratifying `detail` + `CREDENTIAL_EXPIRING` (kind list extension, rank
   below OFFLINE_AGENT/above sunsets), with a back-pointer added per the
   amends-list convention in `researches/architecture-decisions.md`.
   `docs/openapi.yaml` regenerated in the same change (ADR-104).

5. **`createdBy` resolution**: `import_agents.createdBy` stores the
   `Actor.id` — a `persons.id`. Read-time `LEFT JOIN persons`, select
   `COALESCE(displayName, username)`; null column or unresolvable person
   → `createdBy: null`. The raw person id never ships as the name.

6. **`enrollmentExpiresAt`**: `import_agents.enrollmentTokenExpiresAt` is
   already selected into `toApi`'s `pendingEnrollment` computation —
   expose it when the token is live (unused + unexpired), else null.
   No new query. Never returns token material (ADR-116's hash-only
   storage already guarantees this).

7. **Field placement**: `createdBy` + `enrollmentExpiresAt` go on the
   core `ImportAgent` contract (`packages/core/src/contracts/
   import-agent.ts`) rather than `AgentDetail` — the same `toApi` serves
   list and detail, both fields are one column each, and the frontend
   `mapImportAgent` signature stays single-input. Spec's FR-004 names
   `GET /agents/:id`; populating the shared shape covers it and keeps
   the list consistent.

8. **"All healthy" importer line**: derivable client-side —
   `summary.data.attention` already lists importer-related kinds
   (`FAILED_RUN`, `OFFLINE_AGENT`). `UxIndexPage` computes the flag;
   no backend field needed. StatGrid gains an `importersHealthy`
   prop (or the page maps it into the deltas prop shape) — presentation
   detail for tasks.

9. **Response shape**: all fields are additions to existing payloads —
   `docs/openapi.yaml` regen (ADR-104) plus `api/types.ts` updates.
   `mapAttentionItem` passes `item.detail` through (currently stubbed
   `null`); `mapImportAgent` wires `createdBy`/`enrollmentExpiresAt`
   (currently stubbed `""`/`null`); index.tsx passes `summary.deltas`.
