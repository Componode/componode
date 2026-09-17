# Implementation Plan: Empty-Body Requests Sent With JSON Content-Type

**Branch**: `bugfix/012-empty-body-content-type` | **Date**: 2026-09-15 | **Spec**: [spec.md](./spec.md)

## Summary

`apiFetch` declared `Content-Type: application/json` unconditionally. Fastify
rejects body-less requests carrying that header (`FST_ERR_CTP_EMPTY_JSON_BODY`
→ `400 INTERNAL_ERROR`), breaking every body-less mutation in the UI: importer
trigger/cancel, logout, session revoke, and all delete actions.

The fix is a single conditional in the client: set the JSON content type only
when `options.body` is present. One change covers all ten affected call sites
because `apiFetch` is the sole `fetch` wrapper.

## Technical Context

**Language/Version**: TypeScript 5, React 18, `@tanstack/react-query` (frontend); Fastify 5 (backend, unchanged)

**Primary Dependencies**: none added

**Storage**: no schema changes, no migrations

**Testing**: Vitest unit test on the api client asserting header behavior for
body-less POST, body-less DELETE, and POST-with-body.

**Target Platform**: Browser SPA; no platform-specific code.

**Project Type**: Monorepo frontend bugfix.

**Constraints**:

- The API contract is authoritative: affected endpoints declare no
  `requestBody` ([ADR-070](../researches/adrs/ADR-070-api-url-structure.md),
  [ADR-104](../researches/adrs/ADR-104-openapi-contract-source-of-truth.md)) —
  conform the client, not the server.
- CSRF double-submit remains enforced on state-changing methods
  ([ADR-087](../researches/adrs/ADR-087-csrf-protection.md)); the
  `x-csrf-token` header is still attached.
- No `requestBody` is added to the OpenAPI spec — the endpoints correctly
  accept no payload.
- Test-first ([Constitution VI](../.specify/memory/constitution.md));
  regression test exists before merge.

## Constitution Check

| Principle | Verdict | Notes |
|---|---|---|
| I. Single-organization, Self-Hosted | Pass | No org/tenant changes. |
| II. Importer-first | Pass | Fixes importer run triggering. |
| III. Two-level taxonomy | Pass | No taxonomy changes. |
| IV. Environment-as-instance | Pass | No data model changes. |
| V. Factual vs. meaning | Pass | No product hierarchy changes. |
| VI. Test-first | Pass | Regression test `api-client.test.ts` added. |
| VII. Observability | Pass | No logging changes. |

No violations.

## Project Structure

### Documentation (this bugfix)

```text
specs/012-bugfix-empty-body-content-type/
├── spec.md       # Requirements, affected surface, scenarios
├── plan.md       # This file
└── tasks.md      # Executable tasks
```

### Source Code (repository root)

```text
packages/frontend/src/api/client.ts                    # conditional Content-Type
packages/frontend/src/test/unit/api-client.test.ts     # new regression test
```

## ADR Impact

No new or amended ADR. The fix aligns the client with the existing contract
(ADR-070/ADR-104); it introduces no new architecture decision. Fastify's
empty-body rejection is correct behavior and is not relaxed.

## Complexity Tracking

No constitution violations — table omitted.
