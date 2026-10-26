# Implementation Plan: Importer Run Aggregates

**Branch**: `031-importer-run-aggregates` | **Date**: 2026-10-24 | **Spec**: [spec.md](spec.md)

## Summary

Resolve ux-rewrite gap G1: add `GET /importer-configs/:id/run-aggregates?days=N`
returning server-computed per-day buckets `{day, runs, created, updated,
failed}[]` (created/updated = `assetsCreated`/`assetsUpdated` sums, failed =
FAILED-status run count — the exact shape the flagged sparkline consumes).
SQL `GROUP BY` on `substr("createdAt",1,10)` keeps cost O(days), not O(rows).
`useRunAggregates` hook feeds `importer-card`'s `RunHistory`; flag flips on.

## Technical Context

**Language/Version**: TypeScript 6, Node 24. **Dependencies**: existing —
Fastify, Kysely, TanStack Query. **Storage**: PostgreSQL `import_runs`, no
migration. **Testing**: vitest (testcontainers backend integration,
component unit). **Constraints**: no `sql.raw`/`sql.fragment` (ADR-084 —
`sql` tagged template is parameterized and allowed); authenticated route,
no new permission (ADR-097); openapi + api.md same change (ADR-104).

## Decisions (research)

- **D1 Route**: `GET /importer-configs/:id/run-aggregates` — sibling to
  `/runs`; static segment avoids `:runId` collision by construction.
- **D2 Bucketing**: `sql`substr("createdAt", 1, 10)` (ISO text →
  `YYYY-MM-DD` day; parameterized tagged template — not `sql.raw`,
  ADR-084 compliant). UTC-day buckets match `createdAt` ordering.
- **D3 Window**: `days` query, default 14 (card sparkline), clamp 1–90 —
  `where("createdAt", ">=", cutoffIso)`; string compare works on ISO.
- **D4 Zero-fill**: sparse SQL rows are expanded server-side to the full
  window so every day appears (zero-height bars per spec).
- **D5 Client**: `useRunAggregates(configId, days)` → maps API rows to
  `ImporterConfig["history"]` `{day, created, updated, failed}`. Called
  inside `importer-card` behind the flag (per-card query; count is small).
  Detail page's runs table is not flagged — untouched.
- **ADR fidelity**: no amendment — new endpoint inside ratified surfaces
  (no new permission, error code, or entity).

## Constitution Check

I single-org ✓ · II importer-first ✓ (reads only) · III taxonomy N/A ·
IV env-as-instance N/A · V factual layer ✓ · VI test-first ✓ ·
VII observability ✓ (request logging middleware; no new runtime path
needing spans). No violations.

## Source touch-points

```text
packages/backend/src/services/import-run-service.ts  # + listRunDayAggregates
packages/backend/src/routes/importers.ts             # + GET /importer-configs/:id/run-aggregates
packages/backend/test/integration/importers-runs.test.ts (or users-style file) # seed + assert
packages/frontend/src/api/hooks/importers.ts         # + useRunAggregates
packages/frontend/src/ux/components/importers/importer-card.tsx  # flag-gated wiring
packages/frontend/src/ux/lib/flags.ts                # historyAggregates → true
docs/openapi.yaml · docs/api.md · researches/ux-rewrite-gaps.md · docs/roadmap.md
```
