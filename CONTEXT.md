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
Component's logical lifecycle. For an actively monitored instance, executed
URL Check outcomes may update this status under ADR-126; `GONE` remains a
source-reconciliation state.
_Avoid_: deployment, environment

**URL Check**:
A configured check of one HTTP(S) URL associated with a ComponentInstance.
A ComponentInstance can have multiple URL Checks; each has its own monitoring
observations and availability history. For actively monitored instances,
executed outcomes also update the current operational status under ADR-126;
`MISSED`, no-data, and disabled checks preserve the last status.
_Avoid_: URL Importer when referring to a monitoring check

**Component Group**:
A declared grouping of Components — either human-declared (a curator assigns
`componentGroupId` one component at a time) or system-provisioned and
source-scoped (an auto-managed group whose membership the backend derives
from ImporterSource memberships, ADR-129). A first-class entity with its
own name, slug, description, and owner.
_Avoid_: folder, collection

**Source-scoped ComponentGroup** (auto group):
A ComponentGroup provisioned by the backend for one ImporterSource under
ADR-129 — membership is derived (the component's sole effective-active
reporter is that source), lifecycle is derived from active members, and
humans cannot edit its lifecycle or membership. Linked durably via
`importer_sources.componentGroupId`.
_Avoid_: auto folder, importer group, cluster (when precision matters, say
"the source's auto-group")

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

**Importer Component profile**:
A named, stable-keyed entry in a Web/API importer collection that describes
one logical Component and its ComponentInstances. It is configuration, not a
catalog entity.
_Avoid_: profile alone when it could mean an Agent Target profile

**ImporterSource** (Source):
A durable provenance entity — "which external system reported this data"
(ADR-119). Keyed by the provider-native canonical identity (engine ID,
org ID, account/subscription ID, canonicalized URL), or the generated,
immutable collection key for Web/API importer profiles (ADR-126); never by
display name. Lifecycle `ACTIVE`/`UNMONITORED`/`RETIRED`; outlives the
`ImporterConfig` that feeds it. Internal provenance — never a catalog
Component.
_Avoid_: connection, endpoint, "source" alone when ambiguity with the
external system matters (say "the Source" or "ImporterSource")

**Source membership**:
The durable record that an ImporterSource reported a given Component or
ComponentInstance — the unit of source-scoped reconciliation (ADR-119,
ADR-036 Amendment 1). Survives run/config deletion; a shared Component
stays `ACTIVE` while any Source reports it.
_Avoid_: last-seen, ownership tag

**Target profile** (`targetId`):
An Agent-local, versioned, read-only access-route descriptor (endpoint +
transport + pinning parameters) resolved by the Import Agent before a
remote run (ADR-116 Amendment 5). Referenced indirectly: config scope
carries a plain `targetId` named by the manifest's `targetRefKey`.
Immutable — a changed endpoint is a new `targetId`. Distinct from
ImporterSource identity and Component identity.
_Avoid_: connection string, remote config

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

**Bill of materials (BOM)**:
A Component's factual package inventory — the set of BOM entries
importers have reported for that Component or one of its
ComponentInstances. Written only by importers; read-only to humans.
_Avoid_: SBOM when referring to the stored model (SBOM is the document
format), dependency list

**BOM entry**:
One observed package, library, or assembly in a Component's BOM —
written only by importers from detected evidence (lockfiles, manifests,
SBOM documents, image layers). Carries a purl, version, scope, evidence
and licences, and may nest under a parent entry for multi-layer
assemblies. Rendered in the UI as a "Package" row.
_Avoid_: dependency (that word belongs to edges), package as the entity
name

**purl** (Package URL):
The canonical package identity string (`pkg:npm/lodash@4.17.21`) carried
by every BOM entry — the interoperability key shared by CycloneDX, SPDX,
and scanner tooling.
_Avoid_: package identifier, coordinates

**Version-free purl**:
A normalized purl with version, qualifiers, and subpath stripped and
purl-spec type casing applied — the identity key for a Library
component's `externalId` and for `/packages` grouping. One catalog
component per version-free purl.
_Avoid_: package name alone as identity

**Library component**:
A first-class Component (category `LIBRARY`) created via *Add to
catalog* or yielded importer-natively by a declared-edge carrier's
opted-in run (spec 076/077) — one per package across all versions,
keyed on the version-free purl. Same lifecycle, source membership, and
graph participation as any Component; hidden from the default
Components list and excluded from coverage denominators.
_Avoid_: package component, dependency record

**Component dependency**:
A component→component edge (`component_depends_on_component`) meaning
"this component depends on that component" — created by dependency
suggestions, the Link action, or Phase 3 importers. Distinct from
`DEPENDS_ON_COMPONENT`, which is product→component.
_Avoid_: component edge, library link

**Dependency suggestion**:
A staged, server-generated candidate that one component may depend on
another, computed from BOM/purl matching, reviewed in the Suggestions
queue's *Component dependencies* segment and decided by a human
(ADR-113 pattern). Sibling of the *candidate edge*, which stays
product-scoped; same terminal-state semantics.
_Avoid_: auto-wire, recommendation

**Evidence source** (BOM):
How a BOM entry was detected — `LOCK_FILE`, `MANIFEST_FILE`,
`SBOM_DOCUMENT`, `IMAGE_LAYER`, `REGISTRY_API`, or `VCS_ANALYSIS`.
Rendered in the UI as "Found in".
_Avoid_: origin

**Direct / Transitive** (BOM):
Whether a component's own manifest declares the package (direct) or it
was pulled in by another package (transitive). Recorded on the BOM
entry's `direct` flag, independent of its scope.
_Avoid_: first-level, nested

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

**BOM entry or Library component?**
Observed by an importer as package inventory → **BOM entry** (factual,
read-only, lives and dies with source reports). Elevated to a curated
catalog entity the graph can depend on → **Library component** — created
through *Add to catalog* or yielded importer-natively by a declared-edge
carrier's opted-in run (spec 076/077), merging on the normalized
version-free purl. The same package exists as both: the entry is the
fact, the component is the curation.

**Edge provenance** (`CURATED` | `IMPORTER`):
Recorded on each component-edge junction row — whether a human wired the
edge or an opted-in import run declared it. Rendered in the UI as
"Curated" / "Added by importer"; an `IMPORTER` edge carries the Source
and import run that wrote it (ADR-133).
_Avoid_: origin, source (Source already means ImporterSource), system edge

**Importer-declared edge**:
A `DEPENDS_ON`/`SOURCES_FROM`/`EXPOSES` component edge materialized by a
completed run of a config opted in via `declaredEdgesConfigKey`. Declared
through `DiscoveredAsset.relationships[]`, resolved same-run only,
retired source-scoped when later runs stop declaring it.
_Avoid_: suggested edge (that is `edge_suggestions`/`bom_component_suggestions`),
auto edge

**Edge suppression** (Hide edge):
The durable, pair-keyed veto in `component_edge_suppressions` — an
Editor-only action on importer-added edges that deletes the junction row
and prevents future runs from recreating the pair. UI copy: "This edge
won't be recreated by future imports."
_Avoid_: delete edge, disable edge, ignore edge
