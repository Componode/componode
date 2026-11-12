# Quickstart: validating the instance environment override

End-to-end validation that the feature works: override persists across imports, provenance shows, reset restores.

## Prerequisites

- Repo deps installed (`pnpm install`), Docker available for testcontainers + Playwright workload.
- `.env` configured if running the dev stack (`docker compose up -d`).

## 1. Backend integration tests

```bash
pnpm --filter @componode/backend exec vitest run test/integration/<new-spec-file>.test.ts
```

Expected: PATCH set/clear/guards/audit pass; an import run after override leaves effective env unchanged while `reportedEnvironment` refreshes.

## 2. Unit + frontend checks

```bash
pnpm --filter @componode/backend test          # unit suite
pnpm --filter @componode/frontend exec vitest run src/test/unit/<detail-test>.test.tsx
pnpm --filter @componode/frontend typecheck && pnpm --filter @componode/frontend lint
pnpm --filter @componode/backend typecheck && pnpm --filter @componode/backend lint
```

## 3. API smoke (dev stack or test harness)

```bash
# Login as EDITOR, then:
PATCH /api/v1/component-instances/{instanceId}   {"environment":"PRODUCTION"}   → 200, instance.environment=PRODUCTION, reportedEnvironment=<old>
PATCH /api/v1/component-instances/{instanceId}   {"environment":null}          → 200, environment back to reported
PATCH /api/v1/component-instances/{instanceId}   {"environment":"NOPE"}        → 400
PATCH /api/v1/component-instances/{instanceId}   {}                            → 400 (key required)
GET   /api/v1/components/{componentId}           → instances[] carry new fields
```

## 4. Playwright journey

```bash
cd playwright && pnpm e2e tests/journeys/<instance-env-spec>.spec.ts
```

Expected journey: component detail → edit instance environment via dialog → badge shows override + reported value → trigger the source's import run again → effective environment still the override → reset → reported value restored.

## 5. Docs gates

```bash
pnpm docs:api && pnpm docs:api:check
pnpm docs:oracle:check && pnpm docs:sidebar:check
```

## Done when

- [ ] Override set via UI persists across a real importer run (Playwright)
- [ ] `reportedEnvironment`/`environmentOverride`/by/at visible in API payloads and UI provenance
- [ ] Reset restores latest reported value in one action
- [ ] Audit entry written per set/clear
- [ ] All backend/frontend/Playwright suites green; openapi.yaml + api.md regenerated; ADR-034 amendment landed
