# Playwright Test Layout

All user-testing specs live under this directory and run serially (one
worker) against the isolated `componode-pw` Compose stack.

## Directory conventions

| Directory | Contents |
| --- | --- |
| `infra/` | Stack lifecycle, preflight, network isolation, TLS trust, secret-path, and reporting tests. |
| `data/` | Table-coverage and fixture/lifecycle assertions. |
| `api/` | Request-context checks for paginated endpoints that have no visible UI controls. |
| `journeys/` | Browser journeys for catalog, organization, and administration areas. |
| `auth/` | Password, session, registration, reset, OIDC, and role-matrix tests. |
| `importers/` | Provider mock contract tests and importer run/reconciliation journeys. |
| `monitoring/` | First-instance recovery, URL Check setup, Hub probes, and Import Agent probes. |
| `accessibility/` | axe scans and keyboard assertions on key routes and interaction states. |
| `security/` | No-secret-in-output assertions for UI, reports, logs, and traces. |
| `smoke/` | Cross-browser smoke journeys tagged `@smoke` for Firefox and WebKit projects. |
| `fixtures/` | Shared Playwright fixtures (role-scoped auth, seed helpers). |

## Conventions

- One spec file per journey area; name files `<area>.spec.ts`.
- Tag the subset of journeys intended for Firefox/WebKit with `@smoke` in
  the test title.
- Prefer accessible locators (`getByRole`, `getByLabel`, `getByText`) over
  CSS selectors; reach for test ids only when no accessible name exists.
- Never print or attach secret values. Tests handling passwords, tokens,
  or Credential payloads create them outside traced browser interaction
  where possible.
- Every implemented area must appear in `../coverage-matrix.md`; update the
  matrix in the same change that adds or removes a journey.
