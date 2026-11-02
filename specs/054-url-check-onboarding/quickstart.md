# Quickstart: URL Check Onboarding Completion

## Prerequisites

- Node.js >= 24 and pnpm >= 9
- Docker available for backend integration tests
- Dependencies installed: `pnpm install`

## Automated validation

```bash
# Backend route/RBAC regression coverage
pnpm --filter @componode/backend exec vitest run --config vitest.integration.config.ts test/integration/components.test.ts test/integration/url-checks.test.ts test/integration/rbac.test.ts

# Frontend onboarding coverage
pnpm --filter @componode/frontend exec vitest run src/test/unit/url-checks.test.tsx src/test/unit/catalog-authoring-042.test.tsx

# API docs contract and generated docs
pnpm --filter @componode/backend test:unit
pnpm --filter @componode/backend docs:api:check

# Full changed-package verification
pnpm --filter @componode/core test --if-present
pnpm --filter @componode/backend lint
pnpm --filter @componode/backend typecheck
pnpm --filter @componode/frontend lint
pnpm --filter @componode/frontend typecheck
```

## Manual acceptance paths

1. **New API Component with an authenticated check**
   - Open `New component with URL checks` as an Admin.
   - Choose category `API`, add an instance and monitoring defaults.
   - Configure Basic/Bearer/custom-header auth using an existing Credential and optional target/window.
   - Submit: the Component, one instance, setup, and checks are created together; no secret is displayed or returned.

2. **Existing zero-instance Component**
   - Open a manually created ACTIVE Component with no instances as an Editor or Admin.
   - In URL Checks, choose `Add first instance`.
   - Save an environment and optional URL/version/region.
   - The same Component refreshes with the new instance; use the normal `Add check` dialog to configure checks.

3. **Role boundary**
   - As Editor, ordinary checks and Hub monitoring setup are available.
   - As Editor, Credential and Import Agent controls explain that Admin access is required; direct writes with `credentialId`, `vantage: "AGENT"`, or non-null `agentId` return `403 AUTH_FORBIDDEN`.
   - As Viewer, URL Check information remains read-only.
