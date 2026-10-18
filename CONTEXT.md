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
