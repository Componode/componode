# Quickstart: Validating the Code-Scanning Fixes

## Prerequisites

- `pnpm install` at repo root; Docker available for testcontainers/e2e.

## 1. Slugify consolidation

```bash
# Core unit tests — corpus parity + adversarial timing
pnpm --filter @componode/core test

# Backend unit tests — slug wrappers still behave (slug.test.ts)
pnpm --filter @componode/backend test -- slug

# Importer contract tests still pass (validateDiscoveredAsset on slugs)
pnpm --filter @componode/importer-aws test
pnpm --filter @componode/importer-kubernetes test
pnpm --filter @componode/importer-github test
pnpm --filter @componode/importer-alibaba-cloud test

# No local regex copies remain (importers + backend services)
rg 'replace\(/\^-\+' packages/backend/src packages/importer-*/src
# → expect matches ONLY in user-service.ts (intentional) and none for the
#   slug chain
```

## 2. OIDC issuer hardening

```bash
# Unit tests for the validation matrix
pnpm --filter @componode/backend test -- settings

# Manual smoke (requires running stack): submit a rejected issuer
curl -X PUT http://localhost:3000/api/v1/settings/oidc \
  -H 'content-type: application/json' -b 'session=…' \
  -d '{"enabled": true, "issuer": "http://10.0.0.1:8080"}'
# → 422 { code: "OIDC_DISCOVERY_FAILED" }
```

## 3. Playwright coverage of the changed surface

```bash
cd playwright
pnpm e2e -- --grep "oidc"
# includes the new issuer-rejection case in tests/auth/oidc.spec.ts
```

## Expected outcomes

- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green.
- Next CodeQL scan: 9 `js/polynomial-redos` findings closed; the
  `js/request-forgery` finding either closed by the validation gate or
  dismissed with the documented admin-gated justification.
