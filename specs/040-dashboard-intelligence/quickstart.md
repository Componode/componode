# Quickstart: Dashboard Intelligence

## Verify the backend fields

1. `pnpm --filter @componode/backend test` — integration tests cover:
   - `GET /dashboard/summary` returns `deltas.{products,components,instances}`
     as trailing-7-day counts scoped to each headline population.
   - Attention rows carry `detail` (OFFLINE_AGENT shows last-contact +
     disconnect reason; FAILED_RUN shows error context).
   - A credential with `expiresAt` in 3 days produces a
     `CREDENTIAL_EXPIRING` row (`href` `/credentials/{id}`, warning tone,
     ranked above sunset items); a null/far-future `expiresAt` produces none.
   - `GET /agents/:id` returns `createdBy` (display name) and
     `enrollmentExpiresAt` for a pending enrollment; nulls when
     unresolvable.
2. `pnpm docs:api` — regenerates `docs/api.md` tables; the openapi
   contract test confirms `AttentionItem.detail`, the new enum value,
   `deltas`, and the agent fields are documented.

## Verify the frontend

1. `pnpm --filter @componode/frontend test` — mapper + component tests:
   `mapAttentionItem` passes `detail` through; `mapImportAgent` wires
   `createdBy`/`enrollmentExpiresAt`; StatGrid renders `+N this week` and
   "All healthy".
2. Manual: `pnpm dev`, open the dashboard — stat cards show `+N this
   week`, the importers card shows "All healthy", attention rows show
   their sub-line, and an expiring credential appears in the queue.
   Agent detail shows "Enrolled by {name}".

## Done when

- `statDeltas`, `attentionDetail`, `credentialExpiring`,
  `agentEnrolledBy` are `true` in `ux/lib/flags.ts` with fallbacks gone.
- `researches/ux-rewrite-gaps.md` marks G23, G24, G25 resolved by spec 040.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` is green.
