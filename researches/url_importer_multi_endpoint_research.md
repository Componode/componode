# URL Importer and Multi-Endpoint Monitoring Research

> **Purpose**: Assess how an administrator should configure multiple URLs for
> one logical Component, and whether the existing URL importers can support
> meaningful per-URL availability and HTTP performance metrics.
>
> **Scope**: Repository UX/domain-model review and a comparison of monitoring
> metric definitions against primary sources. The user-confirmed direction
> from 2026-11-01 is ratified in ADR-123 and its amendments; this report
> carries the research rationale and next-session handoff. No code, schema,
> feature specification, or UX-gap changes are made.
>
> **Source availability**: Repository sources were read directly. External
> citations are standards and first-party documentation; this environment
> provided search-indexed excerpts rather than direct page retrieval.
>
> **Relationship to existing work**: This report is informative, not
> authoritative. The architectural decisions live in
> [ADR-123](./adrs/ADR-123-http-url-check-monitoring.md) and its amendments;
> a future feature spec must follow them and ratify any additional closed
> contract surface before implementation.

---

## Bottom line

The current `web-url` and `api-url` importers each take one URL and discover
one Component with one `PRODUCTION` ComponentInstance. They are single-endpoint
catalog imports, not a URL-monitoring system: they do not retain a
per-endpoint observation history for availability, error rate, or latency
percentiles.

**Ratified direction (ADR-123):** replace the two URL-specific monitoring
experiences with one generic HTTP(S) monitoring capability, separate from
importer runs.
An administrator manages checks from a Component, either by adding them to an
existing Component or creating a Component and its first checks together.
Each check has its own stable monitoring identity and observation history,
separate from `ImporterSource` and `import_runs`. ADR-123 amends ADR-014,
ADR-077, and ADR-107 to record this model, its persistence inventory, and its
Credential relationship.

A check attaches to the ComponentInstance it monitors. A ComponentInstance
continues to mean an operational occurrence in an environment; multiple URL
checks for the same deployment may attach to one instance, while distinct
deployments remain distinct instances. Monitoring status and history do not
overwrite importer-reported `ComponentInstance.status`. Sibling URLs are not
separate Components and should not be combined with a ComponentGroup, which
represents human-declared equivalence across distinct source Components.

The agreed initial probe profile is a shared five-minute schedule per
Component monitoring setup, with per-check overrides if needed; rolling
24-hour, 7-day, and 30-day summaries; and 30 days of detailed observations.
Probes use GET by default, may use HEAD where configured, do not follow
redirects, and do not parse or retain response bodies. Latency percentiles
describe request-to-response-headers/TTFB, not full-body download time. Raw
response headers are not retained by default.

For checks attached to an API-category Component, support Basic Auth, Bearer
Token, and multiple custom headers. Authentication is configured per check,
may reuse a Credential, and uses the existing write-only credential model.
The `Authorization` header is reserved for the named Basic/Bearer modes.

The existing URL destination restrictions remain exactly as recorded in
ADR-106; this research does not relax them. That ADR's residual DNS-rebinding
risk and deployment egress guidance remain relevant.

## 1. Current Componode behavior

### Import and persistence

- The Web URL guide describes one URL per config, one `WEB_ENDPOINT`
  Component, and one `PRODUCTION` instance. The API URL guide has the same
  cardinality, but parses and stores a JSON payload. The Web URL importer
  stores a 200-character body preview. ([Web URL guide](../docs/importers/web-url.md#L8-L20),
  [API URL guide](../docs/importers/api-url.md#L8-L17),
  [Web URL implementation](../packages/importer-web-url/src/importer.ts#L24-L75),
  [API URL implementation](../packages/importer-api-url/src/importer.ts#L24-L72))
- Each current config has a single `url` field. Its canonicalized URL is
  reported as the ImporterSource identity and used as the Component and
  ComponentInstance external identity. ([Web URL config](../packages/importer-web-url/src/config.ts#L4-L14),
  [ADR-119](./adrs/ADR-119-importer-source-identity-and-lifecycle.md#L21-L45))
- Both current URL importer manifests declare `secrets: []`, and their guides
  say credentials are not supported. API authentication is a new capability,
  not a currently exposed setting. ([API URL manifest](../packages/importer-api-url/src/manifest.ts#L3-L12),
  [Web URL guide](../docs/importers/web-url.md#L22-L31),
  [API URL guide](../docs/importers/api-url.md#L28-L31))
- The core contract already permits one discovered Component to carry multiple
  `instances[]`. Instance upsert is by `(componentId, instanceExternalId)`;
  `environment` is an attribute, not part of that key. Source memberships
  track Component and ComponentInstance provenance separately, and a
  completed run reconciles only the reporting Source's memberships.
  ([ADR-014](./adrs/ADR-014-environment-separate-componentinstance-entity.md#L8-L35),
  [ADR-034](./adrs/ADR-034-componentinstance-upsert-key.md#L8-L14),
  [ADR-057](./adrs/ADR-057-discoveredasset-final-shape.md#L8-L32),
  [ADR-119](./adrs/ADR-119-importer-source-identity-and-lifecycle.md#L46-L72))
- The backend loops over every instance yielded for a Component, upserts each
  by that key, and records per-Source instance memberships. This is a useful
  foundation for endpoint rows, but the URL importers currently yield only one
  instance. ([import-run-service](../packages/backend/src/services/import-run-service.ts#L404-L418),
  [source-scoped instance reconciliation](../packages/backend/src/services/import-run-service.ts#L533-L555))
- Current import results do not constitute metric history. The importer writes
  a current response status into Component details and the latest status into
  its ComponentInstance; the importer detail page presents run history as
  processed/created/updated/orphaned counts and run duration, not one
  observation stream per URL. ([Web URL implementation](../packages/importer-web-url/src/importer.ts#L44-L69),
  [API URL implementation](../packages/importer-api-url/src/importer.ts#L44-L69),
  [importer detail](../packages/frontend/src/ux/components/importers/importer-detail.tsx#L95-L110),
  [run detail](../packages/frontend/src/ux/components/importers/run-detail.tsx#L160-L168))

### Current UX

- `/importers/new` is a general importer setup flow. It asks for importer,
  label, execution, credential, scope, and schedule; the page's introductory
  copy frames an importer as discovering Components in a provider account.
  The URL-specific scope is currently one required field, and nested/complex
  scope shapes fall back to JSON rather than a purpose-built editor.
  ([new importer route](../packages/frontend/src/ux/app/importers/new.tsx#L11-L42),
  [importer form](../packages/frontend/src/ux/components/importers/importer-form.tsx#L452-L457),
  [scope editor](../packages/frontend/src/ux/components/importers/importer-form.tsx#L592-L677),
  [scope schema renderer](../packages/frontend/src/ux/components/importers/scope-schema.ts#L78-L94))
- Importer configs appear as cards on the Importers page. The page has an
  “Add importer” action and the importer detail page shows that config's
  schedule and run history. This is appropriate for source integrations, but a
  card per URL will become noisy when an administrator is managing many
  endpoints for one Component. ([Importers page](../packages/frontend/src/ux/app/importers/index.tsx#L47-L75),
  [importer detail](../packages/frontend/src/ux/components/importers/importer-detail.tsx#L25-L49))
- Component detail already has an **Instances** table and a nested-row
  disclosure pattern for instance observation details. Today it shows
  environment, status, version, region, external ID, and last seen, but not a
  URL, current HTTP status, or metric history. This is the natural place to
  make endpoint health discoverable. ([Component detail](../packages/frontend/src/ux/components/catalog/component-detail.tsx#L125-L195))
- The dashboard's Instance health card is explicitly a current snapshot
  (“As reported by the latest import of each source”), not an uptime trend.
  ([Instance health card](../packages/frontend/src/ux/components/dashboard/instance-health-card.tsx#L16-L47))
- The importer form's fastest named preset is hourly, with custom cron also
  available. That is an importer schedule, not a probe-cadence product contract;
  a high-frequency probe loop should not be smuggled into normal catalog
  reconciliation. ([schedule presets](../packages/frontend/src/ux/components/importers/importer-form.tsx#L36-L43))
- The current importer form presents one Credential selector per config.
  The credential store supports named key/value bundles and write-only values,
  but per-check credentials and variable custom-header rows are new monitoring
  UX/data-contract requirements. ([Credential selector](../packages/frontend/src/ux/components/importers/importer-form.tsx#L563-L585),
  [Credential store ADR](./adrs/ADR-107-credential-store.md#L20-L46),
  [credential form](../packages/frontend/src/ux/components/admin/credential-form.tsx#L42-L54))

## 2. Domain model and design options

### Recommended user mental model

Use **Component** for the logical thing being cataloged and
**ComponentInstance** for each operational occurrence in an environment.
Represent each independently configured URL as a monitoring check attached to
the relevant ComponentInstance. For example:

```text
Component: Checkout
  ComponentInstance: Production — checkout deployment
    URL check: public storefront
      URL: https://shop.example.test/
    URL check: readiness
      URL: https://shop.example.test/health/ready
  ComponentInstance: Staging — checkout deployment
    URL check: readiness
      URL: https://staging-shop.example.test/health/ready
```

Each check needs a stable identity independent of its display label. The
ComponentInstance retains its own identity and environment; multiple checks
may belong to the same instance. Removing a check removes that monitoring
definition and its future samples; a failed probe is an observation, not
evidence that the check or instance disappeared. Component lifecycle,
ComponentInstance operational status, and URL-check status/history remain
distinct.

### Options

| Option | User experience | Fit and trade-offs |
|---|---|---|
| **A. One monitoring setup per Component, repeated checks** | One setup flow and one recognizable group; checks are visible together on the Component detail page. | **Agreed UX.** Each check has its own identity/history and attaches to a ComponentInstance; importer source identity is not reused. |
| **B. One importer config per URL, with a Component selector** | Familiar single-URL form, but many configs/cards for one Component. | Not selected. The current importer derives Component identity from the URL and has no Component selector; probe cadence/history would still be conflated with importer runs. |
| **C. Dedicated HTTP(S) monitoring capability, separate from importer runs** | “Add URL check” from a Component; checks and their histories live with the Component they monitor. | **Agreed technical boundary.** It gives probe observations their own identity, schedule, retention, and query model instead of turning each sample into a catalog import run. |
| **D. One Component per URL, joined with ComponentGroup** | Existing URL importer repeated for every address, followed by manual grouping. | Rejected. ComponentGroup represents human-declared equivalence across distinct source Components, not endpoints of one Component. ([CONTEXT.md](../CONTEXT.md), [ADR-082](./adrs/ADR-082-componentgroup.md#L5-L22)) |

**Agreed direction:** use Option A's per-Component setup with Option C's
dedicated monitoring identity and history. Start from a Component detail page
with **Add URL check**, or create a Component and its first checks in one flow.
Preserve the existing importer and ImporterSource contracts for discovery;
URL monitoring is not represented as a new ImporterSource.

## 3. Suggested UX additions

1. **Make the association explicit.** Start from the Component detail page
   where possible; otherwise, ask whether the administrator is adding checks
   to an existing Component or creating a new one. Do not create one Component
   for every URL by default.
2. **Use a real repeated-row editor.** Each check row should have a
   human-readable name, URL, selected ComponentInstance, and enabled state.
   Put the shared five-minute cadence and common status policy outside the
   rows; expose optional per-check overrides under an “Advanced” disclosure.
   For API-type checks, offer `None`, Basic Auth, Bearer Token, or Custom
   Headers, with each check selecting a reusable Credential. Include “Add
   another URL” and a useful empty state. Avoid asking administrators to edit
   raw JSON for a common task.
3. **Give the endpoint table useful operational columns.** On the Component
   detail page, show endpoint name/URL, environment, current status, latest
   HTTP code, last checked, and a small recent availability/latency summary.
   Keep the existing table and badge conventions. Selecting a row should open
   a detail view with the time window, probe history, error reason, and
   percentile values. A displayed percentage must include its period and
   observation vantage.
4. **Keep importer operations and monitoring distinct.** Checks and their
   history belong with the ComponentInstance they monitor, but their status
   must not overwrite importer-reported ComponentInstance status. A failed URL
   should be shown as a check-level failure without making healthy sibling
   checks disappear.
5. **Explain where the probe runs.** Show whether probes run from the Hub or a
   named Import Agent. Phrase results as “reachable from …”, not global
   Internet availability. The existing UI already exposes the selected
   executor and run executor.
6. **Preserve the established design system.** Use the existing compact
   tables, status badges, page anatomy, accessible labels, and empty/loading/
   error states. A first-class endpoint list editor is an exception to the
   current schema-only form renderer and should be called out in the future
   spec/UX baseline; `docs/ux.md` currently defers custom importer-form widgets.
   ([UX reference](../docs/ux.md#L23-L35),
   [page conventions](../docs/ux.md#L120-L145),
   [open decisions](../docs/ux.md#L218-L233))

## 4. Per-URL metric definitions and presentation

| Requested metric | Recommended definition and display |
|---|---|
| **Availability / uptime** | Percentage of scheduled probes that satisfy that check's success policy during a stated window. Show rolling 24-hour, 7-day, and 30-day summaries, e.g. “99.94% · last 30 days · 5-minute checks · Hub”. It is a sampled synthetic SLI, not a guarantee or a measurement from every user's network. [Google SRE](https://sre.google/sre-book/service-level-objectives/) defines availability as a service-level indicator and commonly measures serving availability as a fraction of successful requests; targets and measurement windows are explicit SLO choices. |
| **HTTP status** | Store the observed status code for each probe and display the latest code plus history. A code is an observation; whether it is healthy is a per-check policy. Default to accepting 2xx, with per-check accepted-status overrides; do not assume only 200 is successful. Do not follow redirects: classify the original 3xx response using the configured policy ([RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html)). |
| **Response time / latency** | Report p50/p95/p99 request-to-response-headers latency per check and window. This is the selected header-only measurement boundary, not full-body download duration. Keep error samples visible or report their latency separately so fast failures do not make successful requests appear slower or healthier than they are ([Google SRE, Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/)). |
| **TTFB** | Use request-start to first response byte as the corresponding phase metric. The W3C Navigation Timing definition describes `responseStart` as the time after the user agent receives the first response byte; a server-side probe has a different vantage but can use the analogous HTTP-client measurement ([W3C Navigation Timing Level 2](https://www.w3.org/TR/navigation-timing-2/)). With bodyless probes, the latency percentiles and TTFB describe substantially the same boundary and should not be presented as two independent measures. |
| **Error rate** | Failed probes divided by all attempted probes in the stated window, using the same configured success policy as availability. Include transport failures (DNS/connect/TLS/timeout) and unacceptable HTTP statuses; retain the normalized failure reason and whether an HTTP response was received. Under one consistent definition, error rate is the complement of availability, so showing both as separate headline cards may be redundant ([Google SRE, Service Level Objectives](https://sre.google/sre-book/service-level-objectives/)). |
| **Target / SLO** | Let administrators optionally set an availability target (e.g. 99.9%) and evaluation window. Present target and observed value separately; do not hard-code 99.9% as a universal target. |

The core measurement should be **one observation per check per scheduled
attempt**, containing the check identity, timestamp, success decision,
optional HTTP status, request-to-headers duration, normalized error type, and
probe executor/location. Retain detailed observations for 30 days and show
rolling summaries for 24 hours, 7 days, and 30 days. Do not store only rolling
p50/p95/p99 values: precomputed quantiles cannot generally be re-aggregated
into a correct percentile for a different period or across executors.
Prometheus recommends histograms when later aggregation/quantile calculation
is needed, and OpenTelemetry models HTTP client request duration as a
histogram ([Prometheus](https://prometheus.io/docs/practices/histograms/),
[OpenTelemetry](https://opentelemetry.io/docs/specs/semconv/http/http-metrics/)).

Use a shared five-minute schedule for each Component monitoring setup by
default, with per-check overrides if needed. Isolate each URL attempt so one
unreachable endpoint does not abort the other checks. A failed probe is an
observation, not evidence that the monitoring check or ComponentInstance was
removed. Monitoring status remains distinct from the imported
ComponentInstance status.

GET is the default request method, with optional HEAD for checks whose
endpoints support it. Do not follow redirects or parse/retain response bodies;
cancel or discard the body after response headers are available. Persist status,
timings, and normalized errors, but no arbitrary response-header values by
default. If a future feature needs response-header values, make them an
explicit allowlist.

### API authentication

Authentication is available only for checks attached to an API-category
Component and is configured per check; a check may reference a reusable
Credential. Supported modes are:

- **Basic Auth** — `username` and `password` secret values.
- **Bearer Token** — one token secret value.
- **Custom Headers** — multiple header names with secret values. Reserve
  `Authorization` for Basic Auth and Bearer Token so modes cannot conflict.

Use the existing Credential store rather than writing secret values into
monitor configuration or URLs. Credential values are AES-256-GCM encrypted
at rest and write-only through the API; `AGENT_MANAGED` references are
resolved on the Import Agent and never expose their values to the Hub
([ADR-107](./adrs/ADR-107-credential-store.md#L20-L46),
[ADR-107 Agent-managed amendment](./adrs/ADR-107-credential-store.md#L84-L89)).
Current URL importer manifests declare no secret keys, while importer
manifests declare fixed named secret keys for credential coverage validation
([API URL manifest](../packages/importer-api-url/src/manifest.ts#L3-L12),
[ImporterSecretDeclaration](../packages/core/src/contracts/importer.ts#L11-L19)).
Because monitoring is separate from importer runs, a feature spec should
define how variable custom-header names map to Credential-held values rather
than implicitly treating them as importer manifest fields. Credential
dependents and usage/deletion protections must also account for monitoring
checks if they reference credentials.

## 5. Important constraints and cautions

- **Probe cadence and run cadence are different.** The fastest named
  ImporterConfig schedule preset is hourly. If the desired outcome is an
  uptime SLI, define a dedicated probe interval and resource/retention bounds;
  do not represent a slow import snapshot as high-frequency uptime monitoring.
- **A single deployment location is not global availability.** Network route,
  DNS, proxy, and TLS trust differ by execution location. Use one consistent
  Hub or Agent vantage per collection and label results with that location.
- **Preserve ADR-106 URL safety behavior.** Do not remove or weaken the current
  HTTP(S)-scheme and destination checks for this monitoring feature. The guard
  evaluates the URL as written: it rejects listed local names and selected
  literal address ranges, but it does not resolve every hostname and guarantee
  that it cannot reach a private address. ADR-106 explicitly records DNS
  rebinding as residual risk and calls for deployment egress restrictions.
  ([ADR-106](./adrs/ADR-106-security-hardening-2026-09-assessment.md#L38-L48),
  [URL safety validation](../packages/core/src/validation/url-safety.ts#L1-L9),
  [URL safety rules](../packages/core/src/validation/url-safety.ts#L103-L133))
- **Do not follow redirects.** Report the original 3xx status as the check
  result and apply the endpoint's accepted-status policy to that response.
  This prevents an additional destination request and keeps the measured URL
  unambiguous. The current importer uses Fetch's default redirect behavior;
  the new monitor's no-follow behavior is an intentional change for this
  feature. The Fetch Standard defines redirect modes and RFC 9110 defines
  2xx, 3xx, 4xx, and 5xx semantics.
- **Don't conflate check state and ComponentInstance status.** Component
  lifecycle is `ACTIVE`/`RETIRED`; ComponentInstance status is operational
  state reported by its existing sources; each monitoring check has separate
  status/history. The current product health rollup is a status rollup, not a
  time-window availability or latency SLO. Percentiles and availability
  should not be substituted into it without a separate decision.
  ([CONTEXT.md](../CONTEXT.md),
  [ADR-112](./adrs/ADR-112-product-health-rollup.md#L10-L38))
- **Keep per-URL detail out of low-cardinality service telemetry labels.**
  Per-endpoint history belongs in a queryable application data model. Existing
  Prometheus conventions deliberately avoid high-cardinality config IDs and
  raw paths; a full URL may also contain sensitive query values.
  ([ADR-069](./adrs/ADR-069-prometheus-metrics.md#L8-L28))
- **Metric visibility is not alerting.** This scope covers collection and
  display only; notifications and alert policies are separate product
  capabilities.

## 6. Follow-up work for a feature spec

The product-level choices are ratified in
[ADR-123](./adrs/ADR-123-http-url-check-monitoring.md), with amendments to
[ADR-014](./adrs/ADR-014-environment-separate-componentinstance-entity.md),
[ADR-077](./adrs/ADR-077-v1-entity-schema.md), and
[ADR-107](./adrs/ADR-107-credential-store.md). The next spec should resolve
implementation details that were not part of the shared direction:

1. Define request timeout, cancellation, concurrency/rate limits, and the
   failure policy for repeated probe errors.
2. Specify storage and query design for 30 days of detailed observations,
   rolling summaries, and percentile calculations; include cleanup and
   scale expectations.
3. Define whether editing a check's URL preserves its identity/history or
   creates a new check, and how disabled/removed checks retain history.
4. Design the credential linkage and secret contract for per-check auth.
   Basic/Bearer use fixed fields; custom header names/count are variable.
   Importer manifest secret declarations are fixed named keys, but the agreed
   monitoring capability is separate from importer runs and needs an explicit
   Credential mapping. Define safe field-name validation, write-only behavior,
   audit redaction, credential testing, and `STORED` versus `AGENT_MANAGED`
   execution.
5. Specify the ComponentInstance status display without overwriting
   importer-reported status, and keep availability/latency out of the current
   product health rollup unless separately ratified.
6. Add required API/OpenAPI documentation and importer/monitor setup guidance.
   Register any missing UX/backend capability and its fallback in the UX-gap
   registry with the matching flag, as required by project rules.

This remains research only; it does not start the spec-kit workflow or alter
ADR-106, ImporterSource identity, code, or schema.

## Handoff to the next session

1. Read `AGENTS.md`, `CONTEXT.md`, this report, ADR-123, and its amendments
   before specifying the feature.
2. Start with `speckit-specify` and create the feature under
   `specs/{NNN-url-check-monitoring}/`. Do not implement directly from this
   report or the ADRs.
3. Carry the engineering questions in §6 into `plan.md` and `tasks.md`, then
   implement phase-by-phase from `tasks.md`. Include failing tests first,
   migrations, API/OpenAPI synchronization, security tests, frontend behavior,
   and user-facing documentation.
4. Run `speckit-analyze` / `speckit-converge` before merge. Keep ADR-106's URL
   restrictions unchanged; any proposal to change them requires a separate
   security decision and ADR process.

## Sources

### Repository sources

- [Ratified monitoring ADR](./adrs/ADR-123-http-url-check-monitoring.md)
- [Amendments to ComponentInstance, schema inventory, and Credentials](./adrs/ADR-014-environment-separate-componentinstance-entity.md),
  [ADR-077](./adrs/ADR-077-v1-entity-schema.md),
  [ADR-107](./adrs/ADR-107-credential-store.md)
- [Web URL importer guide](../docs/importers/web-url.md)
- [API URL importer guide](../docs/importers/api-url.md)
- [ComponentInstance model and importer identity/reconciliation ADRs](./adrs/ADR-014-environment-separate-componentinstance-entity.md),
  [ADR-034](./adrs/ADR-034-componentinstance-upsert-key.md),
  [ADR-035](./adrs/ADR-035-instance-reconciliation-orphan-missing-instances.md),
  [ADR-036](./adrs/ADR-036-two-phase-reconciliation-scope.md),
  [ADR-057](./adrs/ADR-057-discoveredasset-final-shape.md),
  [ADR-119](./adrs/ADR-119-importer-source-identity-and-lifecycle.md)
- [ADR-106 URL safety](./adrs/ADR-106-security-hardening-2026-09-assessment.md)
- [ADR-107 Credential store](./adrs/ADR-107-credential-store.md)
- [Importer secret declaration contract](../packages/core/src/contracts/importer.ts)
- [Credential form and importer Credential selector](../packages/frontend/src/ux/components/admin/credential-form.tsx),
  [Importer form](../packages/frontend/src/ux/components/importers/importer-form.tsx)
- [UX/UI reference](../docs/ux.md)

### Primary external sources

- [Google SRE, Service Level Objectives](https://sre.google/sre-book/service-level-objectives/) — SLI, availability, latency, error-rate and measurement-window framing.
- [Google SRE, Monitoring Distributed Systems](https://sre.google/sre-book/monitoring-distributed-systems/) — latency, traffic, errors, and error-latency considerations.
- [W3C Navigation Timing Level 2](https://www.w3.org/TR/navigation-timing-2/) — `requestStart`, `responseStart`, and first-response-byte timing.
- [Prometheus, Histograms and summaries](https://prometheus.io/docs/practices/histograms/) — percentile calculation, window trade-offs, and aggregation properties.
- [OpenTelemetry, HTTP metrics semantic conventions](https://opentelemetry.io/docs/specs/semconv/http/http-metrics/) — HTTP client request-duration histogram and status/error attributes.
- [WHATWG Fetch Standard](https://fetch.spec.whatwg.org/) — default redirect mode and redirect-following behavior.
- [RFC 9110, HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html) — status-code classes and 301/302/404/500/503 semantics.
