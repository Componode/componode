# Data Model — URL Check Monitoring (spec 051)

Migration `024_url_checks.ts`. Columns camelCase, tables snake_case; ids are
UUID v7 supplied by the app; CHECK constraints come from
`packages/core/src/constants/url-check.ts`.

## `component_monitoring_setups`

One row per Component (unique). Shared monitoring defaults.

| Column | Type | Constraints |
|---|---|---|
| `id` | uuid | PK |
| `componentId` | uuid | FK→`components.id` ON DELETE CASCADE, UNIQUE, NOT NULL |
| `cadenceSeconds` | integer | NOT NULL, default 300, CHECK 60..86400 |
| `vantage` | text | NOT NULL, CHECK in (`HUB`,`AGENT`) |
| `agentId` | uuid | FK→`import_agents.id` ON DELETE RESTRICT, NULL; NOT NULL when `vantage='AGENT'`, NULL when `HUB` (CHECK) |
| `createdAt`/`updatedAt` | timestamptz | NOT NULL, default now() |

## `url_checks`

| Column | Type | Constraints |
|---|---|---|
| `id` | uuid | PK |
| `setupId` | uuid | FK→`component_monitoring_setups.id` ON DELETE CASCADE, NOT NULL |
| `componentInstanceId` | uuid | FK→`component_instances.id` ON DELETE CASCADE, NOT NULL |
| `credentialId` | uuid | FK→`credentials.id` ON DELETE RESTRICT, NULL (required for auth modes other than NONE) |
| `name` | text | NOT NULL |
| `url` | text | NOT NULL (validated by `urlSafetyError` at write + run) |
| `method` | text | NOT NULL, CHECK in (`GET`,`HEAD`), default `GET` |
| `enabled` | boolean | NOT NULL, default true |
| `cadenceSeconds` | integer | NULL → inherit setup cadence; CHECK 60..86400 |
| `successPolicy` | jsonb | NOT NULL, default `{"ranges":[{"min":200,"max":299}],"codes":[]}` |
| `authMode` | text | NOT NULL, CHECK in (`NONE`,`BASIC`,`BEARER`,`CUSTOM_HEADERS`), default `NONE` |
| `authConfig` | jsonb | NULL; key-name mappings only (R6) |
| `availabilityTarget` | numeric(5,2) | NULL; percent 0–100 |
| `targetWindow` | text | NULL; CHECK in (`24H`,`7D`,`30D`) when set |
| `nextProbeAt` | timestamptz | NULL when disabled |
| `createdBy`/`updatedBy` | text | NULL |
| `createdAt`/`updatedAt` | timestamptz | NOT NULL, default now() |

Indexes: `(setupId)`, `(componentInstanceId)`, `(enabled, nextProbeAt)` partial
for the sweep.

## `url_check_observations`

| Column | Type | Constraints |
|---|---|---|
| `id` | uuid | PK |
| `urlCheckId` | uuid | FK→`url_checks.id` ON DELETE CASCADE, NOT NULL |
| `scheduledAt` | timestamptz | NOT NULL — the slot this observation belongs to |
| `outcome` | text | NOT NULL, CHECK in (`SUCCESS`,`FAILURE`,`MISSED`) |
| `httpStatus` | integer | NULL — only when a response was received |
| `durationMs` | integer | NULL — request-start → response-headers for executed probes |
| `errorType` | text | NULL; CHECK in bounded enum (`DNS`,`CONNECT`,`TLS`,`TIMEOUT`,`HTTP_STATUS`,`POLICY_BLOCKED`,`AGENT_OFFLINE`,`ABORTED`,`OTHER`) when FAILURE/MISSED |
| `vantage` | text | NOT NULL, CHECK in (`HUB`,`AGENT`) |
| `agentId` | uuid | NULL; set when `vantage='AGENT'` |
| `createdAt` | timestamptz | NOT NULL, default now() |

Indexes: `(urlCheckId, scheduledAt DESC)`; `(scheduledAt)` for the retention
purge.

## Constants (`core/constants/url-check.ts`)

`URL_CHECK_METHODS`, `URL_CHECK_AUTH_MODES`, `URL_CHECK_VANTAGES`,
`URL_CHECK_OUTCOMES`, `URL_CHECK_ERROR_TYPES`, `URL_CHECK_TARGET_WINDOWS`,
`URL_CHECK_DEFAULT_CADENCE_SECONDS=300`, `URL_CHECK_MIN/MAX_CADENCE_SECONDS`,
`URL_CHECK_RETENTION_DAYS=30`, `URL_CHECK_DEFAULT_TIMEOUT_MS=30000`,
`URL_CHECK_WINDOWS` (`24H`,`7D`,`30D`).

## State transitions

- Setup: created (explicitly or auto-created with defaults on first check) →
  updatable cadence/vantage; deleted only with its Component.
- Check: created → `nextProbeAt` set → `enabled` toggles (enable sets
  `nextProbeAt=now`; disable clears it) → deleted (cascade observations).
- Observation: immutable, append-only, purged after 30 days.

## Metric computation (read path)

Per check + window (`scheduledAt >= now() - window`):

- `availability = SUCCESS / (SUCCESS + FAILURE + MISSED)` (null when zero
  scheduled)
- `coverageGap = MISSED / total`
- `errorRate = FAILURE / (SUCCESS + FAILURE)` (null when zero attempts)
- `p50/p95/p99 = percentile_cont(0.5|0.95|0.99) WITHIN GROUP (ORDER BY
  durationMs)` over `outcome='SUCCESS' AND durationMs IS NOT NULL`
- `latest`: most recent observation (status, outcome, errorType, vantage)

## Validation rules (service layer)

- `url` → `urlSafetyError` must be null (write AND probe time).
- `componentInstanceId` must belong to the setup's `componentId`.
- `authMode != NONE` ⇒ `credentialId` required; Component `category === 'API'`
  (FR-019); authConfig keys must exist in the credential bundle.
- `CUSTOM_HEADERS` names: HTTP token-name charset; `Authorization` rejected.
- AGENT vantage ⇒ referenced credential kind must be `AGENT_MANAGED` (R6).
- `availabilityTarget`/`targetWindow` set together or both null.
