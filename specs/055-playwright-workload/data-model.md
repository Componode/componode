# Test Workload Data Model

This feature does not change Componode's production data model. The fixture model below describes test-run state and synthetic data. The table-by-table source and lifecycle map remains authoritative in [`../../playwright/data/fixture-matrix.md`](../../playwright/data/fixture-matrix.md).

## Test entities

| Entity | Purpose | Relationships and constraints |
| --- | --- | --- |
| Test Run | One complete isolated execution, including environment, generated test identities, fresh database, selected mock scenarios, reports, and cleanup result. | A run owns one Compose project identity and one fresh DB volume; runs do not share mutable state. |
| Test Actor | Disposable Componode Admin, Editor, or Viewer identity used for browser/API journeys. | Admin is bootstrapped; other actors are created through supported user management. Sessions are created by real login. |
| Synthetic Fixture | Deterministic non-production rows and fixture payloads. | Foreign keys and application CHECK constraints are respected. Human-authored Digital Products remain distinct from importer-discovered Components. |
| Mock Scenario | A controlled provider or URL Check response profile such as baseline, empty, changed, omitted, or failure. | The selected profile is isolated to a serialized test run; it cannot forward to a live provider. |
| ImporterSource Membership | The provider provenance linking a Source to a Component or Component Instance. | Created by importer runs, not by direct fixture rows for reconciliation assertions; shared Components remain active while another Source reports them. |
| Failure Evidence | Sanitized HTML/JUnit result, trace, screenshot, video, and diagnostics. | Generated only under ignored Playwright paths; credential values, private keys, and tokens are excluded. |

## Table coverage

The application has 35 persistent data tables plus `kysely_migration` and `kysely_migration_lock`, which are migration bookkeeping and excluded. Each application table receives an explicit fixture, lifecycle-generated row, or supported-operation mapping in the Playwright fixture matrix.

Use direct inserts only for high-volume deterministic baseline rows where they do not bypass the behavior under test. Create encrypted Credentials, Auth/Sessions, ImporterRuns, ImporterSources/memberships, audit history, AgentSessions, URL Check observations, and other append-only/lifecycle data through supported application operations.

## Pagination boundary fixtures

- Seed 201 Components for the UI's 100-row auto-fetch, yielding two full responses and a final partial response.
- Use that same dataset for direct API page-size 50 and 100 boundary checks.
- Seed 101 activity and Suggestions rows for default 50-row limit/offset tests.
- Other lists have no current server-side pagination parameters; their coverage focuses on filters, ordering, empty/error states, and supported mutations.
