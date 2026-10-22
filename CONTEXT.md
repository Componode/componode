# Componode

Componode is a single-organization Digital Product Asset Management tool: an
importer-first component catalog enriched by a human-curated product hierarchy
(the Composable Product Model).

## Language

**Digital Product**:
A curated, meaningful thing the organization delivers or operates —
an application, capability, or shared platform. Human-authored, never
imported.
_Avoid_: product asset, service, application (as a catalog term)

**Component**:
A building-block asset discovered by importers — a repository, workload,
database, endpoint, etc.
_Avoid_: asset, resource, service

**Component Instance**:
The operational occurrence of a Component in an environment; carries the
operational status (`RUNNING`/`STOPPED`/`ERROR`/`GONE`), distinct from the
Component's logical lifecycle.
_Avoid_: deployment, environment

**Component Group**:
A human-declared equivalence across distinct source assets (e.g. three EC2
instances in three accounts considered the same logical component). A
first-class entity with its own name, slug, description, and owner.
_Avoid_: folder, collection

**COMPOSES**:
A product→product edge meaning "parent is composed of child." A DAG with
unlimited depth; any product type may be a parent (ADR-109); cycles are
rejected at write time.
_Avoid_: parent-of, contains

**CONSUMES_FROM**:
A product→product edge meaning "product consumes a shared `PLATFORM`
product." A different relationship from COMPOSES — never rendered in the
composition tree.
_Avoid_: depends-on-product, uses

**DEPENDS_ON_COMPONENT**:
A product→component edge meaning "the product depends on this component."
_Avoid_: uses, contains-component

**Retire**:
The reversible lifecycle transition `ACTIVE → RETIRED` — the default way to
remove an entity from view. Retired entities keep their data and
relationships and are excluded from default queries unless explicitly
requested; `RETIRED → ACTIVE` restores visibility.
_Avoid_: delete, archive, deactivate

**Delete** (hard):
Permanent removal of a record. For Digital Products, permitted only when the
product has no edges; a wired-in product must be retired instead.
_Avoid_: remove

**Root** (product tree):
A Digital Product with no `COMPOSES` parent. Positional, not type-based —
usually a `BUSINESS_CAPABILITY` or `CUSTOMER_FACING` product, but an
unparented `PLATFORM` is a root too.
_Avoid_: top-level type

**Line of Business / Team / Person**:
Ownership and organizational entities referenced by products and groups.
_Avoid_: department, org unit

**Importer**:
A pull-only integration that discovers Components from an external source.
_Avoid_: connector, sync

**Import Agent**:
A remotely deployed executor that runs importers inside a restricted network
and streams discovered assets to the hub over an agent-initiated outbound
WebSocket (ADR-116). Stateless, opt-in per importer config; secrets resolve
agent-side via agent-managed credentials (ADR-117).
_Avoid_: runner, worker, satellite

**Enrollment Token**:
A single-use, short-lived (~24 h) secret issued when an Import Agent is
created or rotated; exchanged once at `POST /api/v1/agent/enroll` for the
agent's durable credential. Stored hashed, never re-displayed.
_Avoid_: join token, bootstrap secret (when precision matters, say
"enrollment token"; the durable result is the "agent credential")

**Agent Session**:
One connected episode of an Import Agent — recorded in `agent_sessions`
with connected/disconnected times, disconnect reason, remote address, and
reported versions. Operational telemetry (connection history), distinct
from audit entries in `entity_changes`.
_Avoid_: socket, connection record

**Agent-managed credential** (`AGENT_MANAGED`):
A credential-store record that holds **secret references only** — `{env}`
/`{file}` names resolved on the Import Agent host — never values.
Distinct from a **stored credential** (`STORED`), which encrypts values on
the hub (ADR-117). Testing routes to the bound agent over the agent
stream; rotation happens entirely on the agent host.
_Avoid_: remote secret, agent token (that term is the agent's own auth
credential)

**Link**:
A curated `{ title, url }` reference attached to a Digital Product or
Component (runbook, repo, dashboard). Human-authored, ordered, max 20;
http(s) only.
_Avoid_: bookmark, attachment

**Tag**:
A lowercase free-form label (`a-z`, `0-9`, `.` `_` `:` `-`, ≤32 chars, ≤20
per entity) on a Digital Product or Component, used for exact-match list
filtering.
_Avoid_: label, keyword, taxonomy

**Criticality**:
A nullable product-only triage hint: `CRITICAL | HIGH | MEDIUM | LOW`.
Informational only — never drives lifecycle or permissions.
_Avoid_: tier, SLA class, severity

**Sunset**:
An optional `sunsetAt` date on a Digital Product or Component announcing
planned decommission. Display-only — passing the date never changes
lifecycle automatically.
_Avoid_: end-of-life state, deprecation gate

**Candidate edge**:
A staged, server-generated suggestion that a product may `DEPENDS_ON` a
component — computed from stored catalog data (names, tags, topics,
namespaces), reviewed in the Suggestions queue, and decided by a human
(ADR-113). `PENDING` until accepted (a real edge) or dismissed; decided
and superseded pairs never resurface.
_Avoid_: auto-wiring, recommendation

**Bootstrap import**:
A one-shot curated upload of a YAML/JSON document declaring Digital
Products and their `DEPENDS_ON` refs — the cold-start path for existing
application inventories (ADR-114). Upserts products by slug; unresolved
refs are reported, never fatal. Not a scheduled importer.
_Avoid_: sync, migration

**Catalog coverage**:
Derived read-only metrics on how completely the catalog is wired — the
share of active components with a product edge, and products without
owner, dependencies, or description. A dashboard signal for the next
curation action.
_Avoid_: scorecard, maturity

## Decision rules

**Product or Component?**
Owned and curated — it has an owner, a description with business meaning,
and edges a person deliberately wired → **Digital Product**. Discovered
infrastructure or workload an importer could find (repository, database,
deployment, endpoint, cloud account) → **Component**.

**External SaaS?**
Vendor services no importer discovers (Stripe, SendGrid, a partner API) →
**Component** with `provider: OTHER`, created manually; group with a
`ComponentGroup` if the same service appears from several sources. Model it
as a `PLATFORM` Digital Product only when the organization governs it as
shared infrastructure — an owner, named consumers, a lifecycle.
