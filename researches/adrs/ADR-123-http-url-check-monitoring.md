# ADR-123 — HTTP(S) URL Check monitoring

**Status**: Ratified (2026-11-01, design discussion; feature spec pending)
**Supersedes**: none
**Amends**: ADR-014, ADR-077, ADR-107 (see "Amendments to earlier ADRs")

## Context

The `web-url` and `api-url` importers each configure one URL and discover a
Component with one `PRODUCTION` ComponentInstance. They record a latest
response-derived status, but do not retain per-URL observations for
availability, error-rate, or latency history. Extending each importer config
to contain a list would conflate catalog discovery, ImporterSource provenance,
and synthetic monitoring.

One Component may need several independently monitored URLs for the same
operational occurrence, while a different environment or deployment remains a
different ComponentInstance. The check result must not overwrite the
importer-reported ComponentInstance status or be mistaken for ImporterSource
reconciliation.

API-type checks also need common authentication. The existing Credential
contract provides encrypted, write-only secret values, but URL importer
manifests currently declare no secrets and Credentials are linked to importer
configs or OIDC, not to monitoring checks.

## Decision

1. **Unified monitoring capability, separate from importer runs.** Provide one
   generic HTTP(S) monitoring capability for the current Web URL and API URL
   use cases. It is not an Importer, ImporterConfig, ImporterSource, or
   `import_runs` workflow. Monitoring checks have their own identity,
   configuration, schedule, and observations. Importer discovery and
   source-scoped reconciliation remain unchanged.

2. **URL Check domain model.** A `URL Check` monitors one HTTP(S) URL and is
   associated with the ComponentInstance it observes. One ComponentInstance may
   have multiple URL Checks; distinct operational occurrences remain distinct
   ComponentInstances. A URL Check is not a ComponentInstance and does not
   alter the meaning of `ComponentInstance.url`.

3. **Independent monitoring state.** Each check has its own current result and
   time-stamped observation history. Probe success or failure does not write
   `ComponentInstance.status`, `Component.lifecycle`, or the derived product
   health in ADR-112. A failed probe is a monitoring result, not evidence that
   the check or ComponentInstance disappeared.

4. **Per-Component setup and execution vantage.** Administrators can add checks
   to an existing Component or create a Component and its first checks
   together. A Component's monitoring setup groups its checks. One stable
   execution vantage applies to the setup: Hub by default or a selected Import
   Agent; displayed metrics identify that vantage. Multi-location aggregation
   is out of scope.

5. **Probe schedule and metric windows.** The default cadence is every five
   minutes for the Component's monitoring setup; an individual check may
   override it. Keep detailed observations for 30 days and display rolling
   24-hour, 7-day, and 30-day summaries. Availability is the share of scheduled
   probes satisfying that check's configured success policy. Error rate is
   failed probes over all attempts under the same policy.

6. **HTTP request and response boundary.**
   - HTTP(S) only. Use `GET` by default; a check may use `HEAD`.
   - Do not follow redirects. Evaluate the original response, including its
     3xx status, under the check's accepted-status policy.
   - Default to accepting 2xx statuses. A check may override its accepted
     status policy; a response code is an observation, not itself a universal
     health judgment.
   - Do not parse or persist response bodies. Cancel or discard the body after
     response headers are available. Do not persist arbitrary response-header
     values by default.
   - The latency boundary is request start through response headers/TTFB.
     Report per-check p50/p95/p99 over the selected window. Do not present
     full-body download duration as measured by this header-only probe, and do
     not present TTFB and this latency boundary as independent metrics.

7. **API-type authentication.** Authentication controls are available only
   when the monitored Component has category `API` (not `WEB_ENDPOINT`). Each
   check chooses its own mode and may reference a reusable Credential:
   - `BASIC`: username and password values.
   - `BEARER`: one token value.
   - `CUSTOM_HEADERS`: multiple request header names and values.
     `Authorization` is reserved for Basic and Bearer modes and cannot be set
     through Custom Headers. Header values are secret material; they are never
     stored in the URL, ordinary monitor configuration, logs, audit payloads, or
     probe observations.

8. **Credential handling.** Reuse the Credential domain from ADR-107. Stored
   values remain encrypted at rest and write-only. `STORED` values resolve in
   the Hub; `AGENT_MANAGED` references resolve on the selected Import Agent.
   One Credential may be reused by multiple URL Checks. Check references
   participate in credential dependent listing, use tracking, revocation, and
   deletion protection. Details of custom-header value mapping and credential
   testing are specified in the feature spec.

9. **Destination safety is unchanged.** Preserve ADR-106's HTTP(S) validation
   and destination checks exactly; this ADR does not relax them. The guard
   validates the URL as written and does not eliminate DNS rebinding. Existing
   deployment egress restrictions remain necessary. Disabling redirects
   prevents follow-on requests but does not replace the initial-destination
   guard.

10. **Persistent model.** Add `url_checks` for configured checks and
    `url_check_observations` for individual probe outcomes to the v1 schema
    inventory. A check belongs to one ComponentInstance; each observation
    belongs to one check. Retain detailed observations for 30 days. Exact
    columns, indexes, cleanup mechanics, and whether the shared per-Component
    setup is a separate stored record are decided in the feature spec and plan.

## Consequences

- Component detail becomes the primary surface for managing checks and seeing
  their independent status and history; importer cards and run history remain
  focused on catalog discovery.
- The frontend needs a repeated-check editor and a per-check auth/credential
  selector. Existing schema-only importer scope rendering is not the model for
  this dedicated monitoring flow.
- The backend needs authenticated check-management and observation read paths,
  scheduled execution, per-check result storage, credential references, and
  retention. Exact routes, permissions, errors, and API shapes are feature-spec
  work and must follow ADR-104.
- The credential store's dependent listing and delete protection must account
  for URL Checks in addition to importer configs and OIDC.
- Product health remains the ADR-112 rollup over ComponentInstance status.
  URL Check availability and latency are not silently folded into it.
- The user-facing importer guides remain accurate until implementation ships;
  their content, API/OpenAPI documentation, UX reference, and UX-gap record
  (if needed) are updated in the feature implementation.

## Amendments to earlier ADRs

- **ADR-014** — clarifies that URL Checks are separate monitoring records
  associated with a ComponentInstance; they do not replace its environment,
  `url`, or operational status.
- **ADR-077** — adds the `url_checks` and `url_check_observations` records to
  the v1 schema inventory; column-level design is deferred to the feature spec
  and plan.
- **ADR-107** — URL Checks become Credential consumers; check references
  participate in credential usage, dependents, revocation, and deletion
  protection while preserving encrypted/write-only values.

**Unchanged**: ADR-106 URL restrictions, ADR-112 product-health aggregation,
and ADR-119 ImporterSource identity and reconciliation.

## Rationale

ImporterSource answers “which external system reported this catalog data?”;
a URL Check answers “how did this configured HTTP target respond from this
execution vantage?” Combining them would make probe samples look like inventory
reconciliation and would bind monitoring history to importer-source lifecycle.
Making a check a ComponentInstance would misclassify multiple routes on one
deployment as multiple operational occurrences and would let a monitor
overwrite status from an importer. Separate check state preserves both domain
meanings while keeping endpoint health visible beside the ComponentInstance it
observes.

## Alternatives considered

- **Extend `web-url` / `api-url` importer scope to a URL list** — rejected.
  It leaves checks coupled to ImporterConfig, ImporterSource identity, and
  import-run reconciliation, and does not provide an appropriate probe-history
  model.
- **Create one Component per URL and join them with ComponentGroup** — rejected.
  ComponentGroup means equivalence between distinct Components, not multiple
  probes for one ComponentInstance.
- **Represent every URL as a ComponentInstance** — rejected. Several routes
  may probe the same operational occurrence; the check is the independent
  monitoring unit.
- **Write probe status into `ComponentInstance.status` or Component details** —
  rejected. This would conflict with importer-reported state or last-writer-wins
  shared Component data, and cannot represent 30 days of observations.
- **Reuse ImporterSource as monitoring identity** — rejected. Monitoring is
  not external inventory provenance and must outlive or evolve independently
  from importer configs.
- **Follow redirects or persist response bodies/headers** — rejected for this
  scope. The configured URL is the probe target; only status, timings, and
  normalized errors are needed for the agreed metrics.

---

**Amended by ADR-125**: onboarding completion ratifies the focused
zero-instance first-`ComponentInstance` endpoint and clarifies that
ordinary checks/Hub setup are EDITOR while Credential and Import Agent
selection are ADMIN via existing `credential:read`/`agent:read`.

## Amendment 1 — Importer-managed definitions and instance status (2026-11-03, ADR-126)

**Context**: The Web/API importer journey needs one config for multiple
Component profiles and instances, with a managed URL Check per instance. The
user-selected model makes ImporterConfig the canonical definition source
while retaining URL Check records, the independent scheduler, and observation
history.

**Refinements**:

- The Web/API ImporterConfig owns each managed check definition. The core
  synchronizes it to `url_checks`; importer packages remain database-free.
  The URL Check scheduler and observation history stay separate from
  `import_runs`, and Component-level monitoring setup continues to own shared
  cadence/vantage defaults.
- URL Check outcomes update monitored `ComponentInstance.status`:
  `SUCCESS` maps to `RUNNING`, `FAILURE` maps to `ERROR`, and `MISSED`,
  no-data, or disabled states preserve the last status. The importer
  one-shot result supplies initial status; after the first check observation,
  subsequent importer status values do not overwrite it. `GONE` remains
  controlled by Source reconciliation. The unchanged ADR-112 rollup
  therefore reflects monitored instance status.
- One managed check is configured per imported ComponentInstance. A check
  may override the instance URL; `GET`/`HEAD`, API-category authentication,
  and the current Credential/key-name rules remain. URL Check
  `autoDisableAfter` remains configurable and uses ADR-124 streak semantics.
- A typed Source-to-check membership permits identical stable check keys to
  share one URL Check across Sources. Direct URL Check write routes and the
  manual Component-create monitoring block are deprecated/read-only;
  importer-managed definitions are edited through ImporterConfig. Legacy
  manual checks are disabled and retained.

**Unchanged**: URL Check observations remain the source for availability,
error-rate, latency, and coverage-gap metrics; the URL Check scheduler remains
independent of importer scheduling; destination safety, bounded probe
execution, and the 30-day observation policy remain in force.

---

**Amended by ADR-126**: ImporterConfig owns managed check definitions,
URL Check records/history and the independent scheduler remain, and check
outcomes update monitored ComponentInstance status.
