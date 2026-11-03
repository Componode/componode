# URL Checks

**URL Checks** are Componode's built-in HTTP(S) monitoring. A check probes
one URL on a schedule and builds an availability, error-rate, and latency
history you can read per check — over rolling 24-hour, 7-day, and 30-day
windows.

A check is attached to the **Component Instance** it observes — the
concrete deployment of a Component in one environment — and one instance
can carry several checks (for example, a public storefront page and a
`/health/ready` path on the same deployment).

URL Checks are **not importers**. Importers discover what exists and write
it into the catalog on a run schedule; a URL Check measures how a
configured HTTP target responds over time. Checks create no Components,
no ImporterSource memberships, and no import runs — their only output is
their own observation history. The canonical vocabulary is in
[CONTEXT.md](https://github.com/Componode/componode/blob/main/CONTEXT.md).

## Monitoring setup: cadence and vantage

Every Component that has checks has a **monitoring setup** — shared
defaults managed once per Component:

- **Cadence** — how often enabled checks probe. Default **5 minutes**;
  allowed range 1 minute to 24 hours. An individual check may override
  it within the same bounds.
- **Execution vantage** — where probes run from:
  - **Hub** (default): the Componode backend probes the URL directly.
    Use it for endpoints the hub's network can reach.
  - **Import Agent**: probes run on a selected [Import
    Agent](./import-agents.md) — for endpoints inside networks the hub cannot
    reach.

One vantage applies to the whole setup; every metric display states it
and reads as "reachable from" that vantage — never a claim of global
availability.

The setup is created automatically (Hub vantage, 5-minute cadence) on the
first run that materializes a managed check; edit cadence and vantage from
the Component's **URL checks** card.

## Managing checks

Checks are **importer-managed**. A Web/API ImporterConfig declares
Component profiles — each instance carries exactly one managed check
definition (`checkKey`), and the importer core synchronizes those
definitions into schedulable rows on every run. The **URL checks** card on
a Component detail page is read-only: it shows each check's status,
latest result, availability, latency, and recent outcomes, plus a
**Managed** badge linking back to the owning ImporterConfig — the only
edit surface.

- **Author** checks by editing the ImporterConfig's profile scope —
  URL, method, cadence override, success policy, auth, availability
  target, and per-check enable live on the check definition there.
- **Pause** a check by setting `enabled: false` on its definition in the
  config; the next run stops scheduling it. Pausing or deleting the
  ImporterConfig pauses all checks it owns, unless another enabled Source
  declares the same `checkKey` (shared checks stay active while at least
  one effective owner remains).
- **Delete** a check by removing its instance (or profile) from the
  config. When the instance's Source membership ends and the instance
  goes `GONE`, the managed check and its observation history are
  removed; otherwise the definition is retained.
- **Manual (legacy) checks** created before managed checks shipped are
  retained, disabled, and read-only — they appear with a **Legacy**
  badge. Direct write routes (`POST/PATCH/DELETE` under `/url-checks`)
  are deprecated and return `410 URL_CHECK_WRITE_DEPRECATED`.

Deleting a Component Instance removes its checks and observations;
deleting a Component removes its monitoring setup and every check under
it. A `RETIRED` Component's checks stop probing but remain readable.

### Check outcomes and instance status

A managed check's executed outcomes are authoritative for the
ComponentInstance it monitors:

- `SUCCESS` → the instance reports `RUNNING`.
- `FAILURE` → the instance reports `ERROR`.
- `MISSED` slots, a disabled check, and no-data windows preserve the
  previous status — they describe probe coverage, not the endpoint.
- `GONE` remains importer-reconciliation territory: a check outcome can
  never resurrect or remove an instance, and statuses on `RETIRED`
  Components are never rewritten.

Before a managed check's first observation, the importer's own status
report seeds the instance status; after that, importer status values no
longer overwrite it.

### Repeated failures and auto-disable

A failing check keeps probing on its configured cadence — every scheduled
slot records exactly one observation; there are no in-slot retries and no
backoff. To bound wasted work, the check **disables itself** after a run
of consecutive non-success observations:

- `FAILURE` and `MISSED` both advance the streak — a check can
  auto-disable while its monitor vantage is down — and `SUCCESS` resets
  it to zero.
- The threshold defaults to **12** consecutive failures fleet-wide
  (`URL_CHECK_AUTO_DISABLE_AFTER`, roughly an hour at the default
  five-minute cadence). Each check can override it in the editor; `0`
  means never auto-disable.
- An auto-disabled check shows **Auto-disabled** (distinct from a manual
  Disabled), stops accruing observations, and records the transition in
  the activity feed. Re-enabling is manual — toggle the check back on to
  reset the streak and resume probing.
- No notifications are sent on failure or auto-disable; alerting is a
  separate, future capability.

For endpoints with no catalog entry yet, the create flow (Components →
_New component_) creates the Component and its first Component Instance
in one pass — checks are declared separately on a Web/API ImporterConfig.
A validation failure creates nothing.

For a manually created ACTIVE Component that has no instances yet, the URL
checks card offers **Add first instance** — save the environment (plus
optional URL, version, and region).

Check *definitions* move with the owning `importer:config:update`
permission on the ImporterConfig; editing a Component's monitoring setup
(cadence, vantage) requires `EDITOR`. Viewing checks and metrics only
requires a signed-in session.

## How a probe works

Each scheduled slot produces exactly one observation:

- **Method**: `GET` by default; `HEAD` is available for endpoints that
  reject `GET`.
- **Redirects are never followed** — the original response, including a
  3xx status, is evaluated as-is.
- **Bodies are never parsed or persisted** — the probe reads response
  headers and discards the body. No arbitrary response-header values are
  stored either.
- Each observation records when it ran, the outcome under the check's
  success policy, the HTTP status when a response arrived, the
  request-to-response-headers duration, a normalized error reason when
  it failed (`DNS`, `CONNECT`, `TLS`, `TIMEOUT`, `HTTP_STATUS`,
  `POLICY_BLOCKED`, `ABORTED`, `OTHER`), and the vantage it ran from.
- A timed-out attempt records a failure — never a slow success and never
  a silently dropped slot. One slow or failing endpoint never delays its
  sibling checks.

### Success policy

By default a check counts any **2xx** response as success. Per check you
can override the policy with explicit status codes and/or ranges — for
example, accept `200` plus `204`, or a `200–299` range plus `429`. A
received status is evaluated against the policy; the policy is the
check's own definition of "up", not a universal health judgment.

### Optional availability target

A check can carry an availability target (e.g. `99.9%`) plus the window
it is evaluated on (`24H`, `7D`, or `30D`). The metric display shows the
target beside the observed availability — clearly labeled as a target,
never implied when unset.

## Metrics and history

Per check, over each rolling window (24 hours, 7 days, 30 days):

| Metric           | Definition                                                                                                                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Availability** | Successful scheduled probes ÷ all scheduled probes — `SUCCESS / (SUCCESS + FAILURE + MISSED)`. Scheduled-but-unexecuted slots count against availability.                                                                               |
| **Error rate**   | Failed probes ÷ executed probes — `FAILURE / (SUCCESS + FAILURE)`.                                                                                                                                                                      |
| **Latency**      | p50 / p95 / p99 of request-start → response-headers duration over successful probes. This boundary **is** TTFB — they are the same measurement, never two metrics.                                                                      |
| **Coverage gap** | The `MISSED` share of the window — scheduled slots that never executed because the agent was offline, the hub was down, or dispatch was rejected. Displayed distinctly so monitor-side downtime is never mistaken for endpoint failure. |
| **Latest**       | The most recent observation: outcome, status code, error reason, and vantage.                                                                                                                                                           |

Every display labels its window and vantage. Detailed observations are
retained for **30 days** and then purged; all metrics are computed from
the stored observations, not pre-aggregated.

### Compact summary on the Component card

The **URL checks** table on the Component detail page shows an
at-a-glance rollup per row — **Availability (24h)** and **p95 (24h)** —
computed over the rolling 24-hour window with the same formulas as the
detail metrics (missed slots count against availability; p95 covers
successful probes only). The window is fixed for the table; the check
detail page still carries the full 24h/7d/30d windows and observation
history.

- A check with no observations in the window shows **No data yet** —
  never a fabricated 0% or 100%.
- When the window contains scheduled-but-missed probes, the availability
  figure carries a **· N missed** annotation so monitor-side downtime
  stays distinguishable from endpoint failure.
- The whole table — every row's summary and the recent-outcome strip —
  loads through a single bounded list request; the card never issues a
  per-check observations request.

## Authenticated checks (API Components only)

Checks on an `API`-category Component may authenticate per check —
authentication controls are not offered on other categories (e.g.
`WEB_ENDPOINT`). Modes:

- **None** — default.
- **Basic Auth** — sends `Authorization: Basic` from a username and
  password.
- **Bearer Token** — sends `Authorization: Bearer` from a token value.
- **Custom headers** — any number of request header name/value rows.
  `Authorization` cannot be set here — it is reserved for the Basic and
  Bearer modes.

Secret values are never typed into check configuration or the URL. Each
check selects a reusable **[Credential](./import-agents.md#agent-managed-credentials-spec-026)**
from the credential store, and its auth fields map to the credential's
key names — never values. One credential can serve many checks; checks
appear in the credential's dependent list, a credential in use by checks
cannot be deleted, and a revoked credential blocks future authenticated
probes. Values stay encrypted and write-only, and never appear in
observations, logs, or audit records.

**Vantage rule**: credentials resolve where the probe runs. A check on
an **Agent-vantage** setup must reference an `AGENT_MANAGED` credential
— reference-only records whose values resolve on the agent host —
because `STORED` credential values never leave the hub. Hub-vantage
checks use ordinary `STORED` credentials.

## URL destination restrictions

Check URLs pass the same destination safety validation as importer URLs
(ADR-106) — HTTP(S) only; `localhost`, private/loopback/link-local
addresses, cloud metadata addresses, and non-HTTP(S) schemes are
rejected. Validation runs at **save time** and again at **probe time**
(on the agent too, for agent-vantage checks).

The guard validates the URL as written and cannot prevent DNS rebinding —
a public hostname may resolve to a private address at request time.
Deployments that expose check configuration should additionally restrict
egress, as with the importers.

## What monitoring status is — and is not

A check's monitoring status is **its own** signal. It is distinct from:

- **ComponentInstance status** (`RUNNING`/`STOPPED`/`ERROR`/`GONE`) —
  the operational state importers report and reconcile. For
  importer-managed checks it *is* probe-owned after the first observation:
  `SUCCESS` → `RUNNING`, `FAILURE` → `ERROR`; `MISSED`, disabled, and
  no-data windows preserve the prior status, and `GONE` stays
  importer-reconciliation territory.
- **Component lifecycle** (`ACTIVE`/`RETIRED`) — the logical curation
  state.
- **Product health** — the derived rollup over dependency instance
  statuses (ADR-112). URL Check availability and latency are not folded
  into it.

The Component detail page renders check status and instance status side
by side as separate signals — that separation is deliberate.

## Tuning (hub environment)

Defaults are the supported values; override only for tests or tuning.

| Variable                            | Default | Purpose                                                                        |
| ----------------------------------- | ------- | ------------------------------------------------------------------------------ |
| `URL_CHECK_SWEEP_INTERVAL_MS`       | `15000` | How often the hub scheduler dispatches due checks                              |
| `URL_CHECK_PROBE_TIMEOUT_MS`        | `30000` | Per-probe timeout (clamped to 60000 ms max)                                    |
| `URL_CHECK_HUB_CONCURRENCY`         | `10`    | Maximum concurrent hub-vantage probes                                          |
| `URL_CHECK_PROBE_RATE_LIMIT`        | `20`    | Max hub-vantage probes dispatched per sweep-interval window                    |
| `URL_CHECK_DEFAULT_CADENCE_SECONDS` | `300`   | Default setup cadence; per-check range 60–86400 s                              |
| `URL_CHECK_AGENT_CONCURRENCY`       | `4`     | Maximum concurrent in-flight probes per Import Agent (integer ≥ 1)             |
| `URL_CHECK_AGENT_RATE_LIMIT`        | `20`    | Max agent-vantage dispatches per sweep-interval window per agent (integer ≥ 1) |
| `URL_CHECK_AGENT_QUEUE_MAX`         | `100`   | Max deferred (queued) probe slots per agent before MISSED (integer ≥ 1)        |
| `URL_CHECK_AUTO_DISABLE_AFTER`      | `12`    | Consecutive non-success probes before a check auto-disables; `0` = never       |

## Agent-vantage bounds and cancellation

Agent-vantage probes are admission-controlled **per agent**: at most
`URL_CHECK_AGENT_CONCURRENCY` probes run concurrently against one Import
Agent, dispatches start no faster than `URL_CHECK_AGENT_RATE_LIMIT` per
sweep interval, and excess work waits in a bounded queue of
`URL_CHECK_AGENT_QUEUE_MAX` slots.

When the queue is also full, the scheduled slot records a **MISSED**
observation with `errorType: SATURATED` — distinguishable from
`AGENT_OFFLINE` misses so "monitor overloaded" never reads as "agent
down". A saturated agent never delays probes for other agents or for
Hub-vantage checks. The agent itself enforces its own cap
(`URL_CHECK_MAX_PROBES`, see
[Import Agents](import-agents.md#environment-variables)) and refuses
excess frames with the same `SATURATED` result, which lands as MISSED.

Cancellation is prompt: when the hub-side dispatch deadline passes it
sends a `url_check.probe.cancel` frame so the agent aborts the in-flight
request rather than running it to the full timeout; a session close
aborts all of the agent's in-flight probes. Every scheduled slot
produces at most one observation — a result arriving after its slot
finalized is discarded, so timeouts, cancellations, disconnects, and
hub restarts can never create duplicate or rewritten observations.

The hub exposes `url_check_agent_probes_in_flight` and
`url_check_agent_probe_queue_depth` gauges (aggregates across agents —
per-agent identity lives on the agent's own `/metrics`), and
`url_check_probes_total{errorType="SATURATED"}` counts saturated slots.
