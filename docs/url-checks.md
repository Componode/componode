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

The setup is created automatically (Hub vantage, 5-minute cadence) when
you add a Component's first check; edit it from the Component's **URL
checks** card.

## Managing checks

From a Component's detail page, **URL checks** card:

- **Add** a check with a name, the URL to probe, and the Component
  Instance it monitors. A check needs an existing instance.
- **Edit** name, URL, method, cadence override, success policy, auth, or
  availability target. Editing the URL preserves the check's identity
  and its entire observation history.
- **Disable** a check to pause probing — no new probes are scheduled and
  no `MISSED` rows accrue (a disabled window is configuration, not
  monitor downtime). History stays visible; re-enabling resumes from the
  next slot.
- **Delete** a check to remove it and all of its observations.

Deleting a Component Instance removes its checks and observations;
deleting a Component removes its monitoring setup and every check under
it. A `RETIRED` Component's checks stop probing but remain readable.

For endpoints with no catalog entry yet, the create flow (Components →
*New component*) can create the Component, its first Component Instance,
and its first checks in one pass — the new Component's page opens with
checks already listed and probing.

Check management requires the `EDITOR` role (create, update, delete, and
monitoring-setup changes); viewing checks and metrics only requires a
signed-in session.

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

| Metric | Definition |
|---|---|
| **Availability** | Successful scheduled probes ÷ all scheduled probes — `SUCCESS / (SUCCESS + FAILURE + MISSED)`. Scheduled-but-unexecuted slots count against availability. |
| **Error rate** | Failed probes ÷ executed probes — `FAILURE / (SUCCESS + FAILURE)`. |
| **Latency** | p50 / p95 / p99 of request-start → response-headers duration over successful probes. This boundary **is** TTFB — they are the same measurement, never two metrics. |
| **Coverage gap** | The `MISSED` share of the window — scheduled slots that never executed because the agent was offline, the hub was down, or dispatch was rejected. Displayed distinctly so monitor-side downtime is never mistaken for endpoint failure. |
| **Latest** | The most recent observation: outcome, status code, error reason, and vantage. |

Every display labels its window and vantage. Detailed observations are
retained for **30 days** and then purged; all metrics are computed from
the stored observations, not pre-aggregated.

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
  the operational state importers report and reconcile. Probe results
  never write it; a failed check does not mark its instance `ERROR`, and
  a healthy check does not mark it `RUNNING`.
- **Component lifecycle** (`ACTIVE`/`RETIRED`) — the logical curation
  state.
- **Product health** — the derived rollup over dependency instance
  statuses (ADR-112). URL Check availability and latency are not folded
  into it.

The Component detail page renders check status and instance status side
by side as separate signals — that separation is deliberate.

## Tuning (hub environment)

Defaults are the supported values; override only for tests or tuning.

| Variable | Default | Purpose |
|---|---|---|
| `URL_CHECK_SWEEP_INTERVAL_MS` | `15000` | How often the hub scheduler dispatches due checks |
| `URL_CHECK_PROBE_TIMEOUT_MS` | `30000` | Per-probe timeout (clamped to 60000 ms max) |
| `URL_CHECK_HUB_CONCURRENCY` | `10` | Maximum concurrent hub-vantage probes |
| `URL_CHECK_PROBE_RATE_LIMIT` | `20` | Max hub-vantage probes dispatched per sweep-interval window |
| `URL_CHECK_DEFAULT_CADENCE_SECONDS` | `300` | Default setup cadence; per-check range 60–86400 s |
