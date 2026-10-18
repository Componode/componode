# DPAM Landscape Research for Componode

> **Purpose**: Survey how the broader industry models "digital products" and
> product/application asset catalogs, and characterize what a *practical*
> (low-hassle) Digital Product Asset Management approach looks like versus the
> heavyweight enterprise-vendor approach (CSDM/CMDB, EA suites). The findings
> inform — but do not override — Componode's existing Composable Product Model.
>
> **Scope**: Primary sources preferred (official docs, published standards,
> vendor white papers). Where a primary source could not be retrieved, the
> claim is marked **[secondary]**.
>
> **Source availability note**: Direct page fetching was not available during
> this research; all citations below are taken from search-indexed excerpts of
> the cited URLs. Quotes from official documentation were reproduced verbatim
> by the search index, but claims citing official docs should be treated as
> "doc excerpt via search index" rather than a full-page read. Community/blog
> sources are additionally marked **[secondary]**.
>
> **Relationship to existing work**: This document complements
> `component_taxonomy_research.md` (which covers the Component side of the
> model) and `adrs/` (ratified decisions). Where a finding conflicts with a
> ratified ADR, it is flagged in §10, never silently overridden.

---

## Executive Summary

1. **The industry converges on a small core**: one "thing being managed"
   (service, application, digital product, fact sheet), a **named owner**,
   grouping/composition edges, and a **health/maturity signal**. Everything
   beyond that is vendor-specific weight. Backstage models this with ~7 kinds;
   Port/Cortex with user-defined blueprints; LeanIX with 12 fact-sheet types;
   ServiceNow CSDM with ~700 CMDB tables — a ~100x spread in metamodel size
   for substantially the same questions (§9).

2. **"Digital Product" is now a standards-level term**, not vendor marketing.
   The Open Group IT4IT 3.0 standard defines it and reorganizes the whole IT
   management reference architecture around it; ServiceNow CSDM 5.0 is
   relabeling "Business Application" to "Digital Product" on that basis.
   Componode's naming choice aligns with the emerging standard vocabulary (§6).

3. **The practical minimum is well documented** by APM practitioners:
   stable ID + name, business owner + technical owner, lifecycle stage +
   sunset/EOL date, business criticality, business capability linkage,
   optional cost, links/tags. Componode's Digital Product field set
   (owner chain, criticality, sunset date, links, tags, lifecycle) maps
   almost exactly onto this documented minimum (§7, §9).

4. **What makes vendors heavy is governance overhead, not features**:
   mandatory metamodel conformance (CSDM), hundreds of pre-defined object
   types, certified taxonomies, federated data-steward workflows (LeanIX
   quality seals, subscription roles), and multi-year crawl-walk-run-fly
   rollout programs. Every heavyweight source *itself* recommends starting
   with a minimal subset (§8).

5. **No one else ships Componode's exact 3-type product enum**
   (BUSINESS_CAPABILITY / PLATFORM / CUSTOMER_FACING), but each type has an
   established industry analog: Business Capability (LeanIX, AWS CAF),
   Platform-as-product (Team Topologies, LeanIX Platform fact sheet,
   CSDM technical services), customer-facing product (SVPG/Thoughtworks
   product operating model, IT4IT consumer-facing digital product). The
   enum is a *compression* of concepts that heavyweight tools keep in
   separate object types (§10).

---

## 1. Backstage Software Catalog (the lightweight reference model)

Source: [backstage.io system model](https://backstage.io/docs/features/software-catalog/system-model),
[descriptor format](https://backstage.io/docs/features/software-catalog/descriptor-format),
[catalog-model API reference](https://backstage.io/docs/reference/catalog-model/).

- **Three core entities + two grouping entities.** The catalog models software
  with *Components* ("individual pieces of software"), *APIs* ("the boundaries
  between different components"), and *Resources* ("physical or virtual
  infrastructure needed to operate a component"). *Systems* group components,
  resources, and APIs; *Domains* group systems
  ([system-model](https://backstage.io/docs/features/software-catalog/system-model)).
- **Component spec is 7 fields.** `ComponentEntity.spec` =
  `{type, lifecycle, owner, system?, dependsOn?, providesApis?, consumesApis?,
  subcomponentOf?, dependencyOf?}`
  ([ComponentEntity interface](https://backstage.io/api/stable/interfaces/_backstage_catalog-model.index.ComponentEntity.html)).
  A System is just `{owner, type?, domain?}`
  ([SystemEntity](https://backstage.io/api/stable/interfaces/_backstage_catalog-model.index.SystemEntity.html)).
- **Ownership is a single required field.** `spec.owner` is an entity
  reference to a Group or User: "the singular entity (commonly a team) that
  bears ultimate responsibility … There may be others that also manage or
  otherwise touch the resource, but there will always be one ultimate owner"
  ([descriptor-format, Resource kind](https://backstage.io/docs/features/software-catalog/descriptor-format)).
- **Type taxonomies are deliberately open.** `spec.type` is a free string
  ("The software catalog accepts any type value, but an organization should
  take great care to establish a proper taxonomy"); well-known component
  types are only `service`/`website`/`library`
  ([descriptor-format](https://backstage.io/docs/features/software-catalog/descriptor-format);
  corroborated by
  [component_taxonomy_research.md](./component_taxonomy_research.md) §2.1).
- **Annotation-driven metadata.** Integration and provider detail lives in
  `metadata.annotations` (e.g. `github.com/project-slug`), not in typed
  fields — the model stays small by pushing specificity into key/value
  annotations and `links`
  ([descriptor-format](https://backstage.io/docs/features/software-catalog/descriptor-format)).
- **What it deliberately avoids**: no environment concept (a known gap —
  `spec.lifecycle` is a *maturity* enum `experimental/production/deprecated`,
  not dev/staging/prod); no cost, no criticality, no health rollup in core;
  no CMDB pretensions — community descriptions characterize the catalog as
  "not a CMDB … it pulls from your VCS and stays current automatically"
  **[secondary — chroniclesofasre.substack.com](https://chroniclesofasre.substack.com/p/why-backstage-the-case-for-an-internal)**.

**Relevance to Componode**: Backstage demonstrates that ~7 kinds + one
required owner field + open type strings + annotations is sufficient to
become the industry-default catalog. Its gap (no environment, no product
layer above System/Domain, no health rollup) is precisely the space
Componode occupies.

## 2. Team Topologies (the intellectual root of "platform products")

Source: [teamtopologies.com/key-concepts](https://teamtopologies.com/key-concepts),
[platform engineering](https://teamtopologies.com/platform-engineering),
[Platform as a Product talk](https://teamtopologies.com/videos-slides/what-is-platform-as-a-product-clues-from-team-topologies).

- **Four team types, three interaction modes.** Stream-aligned, Enabling,
  Complicated-Subsystem, and Platform teams; interactions limited to
  Collaboration, X-as-a-Service, Facilitation
  ([key-concepts](https://teamtopologies.com/key-concepts)).
- **Platform team definition** (the key one for DPAM): "a grouping of other
  team types that provide a compelling internal product to accelerate
  delivery by Stream-aligned teams" — i.e. a *platform is defined by having
  internal customers*, not by technology
  ([key-concepts](https://teamtopologies.com/key-concepts)).
- **Platform-as-a-product is product thinking applied inward**: the practice
  "understanding its value proposition, its customers, and the platform
  adoption lifecycle" — including the "Thinnest Viable Platform" concept and
  "platform optionality" (consumers should *choose* to adopt, not be forced)
  ([academy.teamtopologies.com Platform as a Product](https://academy.teamtopologies.com/courses/platform-as-a-product)).
- **Cognitive load is the stated optimization goal**: "The primary goal of
  all internal platforms is to reduce the cognitive load on its customers,
  i.e. the developers using its services" — and "Should this (platform)
  exist? [is] the most critical question for any platform leader and the
  most overlooked"
  ([platform-engineering](https://teamtopologies.com/platform-engineering)).
- **Consumers vs. providers is a first-class distinction**: the
  "X-as-a-Service" interaction mode formalizes a product→product consume
  relationship between stream-aligned teams and platform teams
  ([key-concepts](https://teamtopologies.com/key-concepts)).

**Relevance to Componode**: Team Topologies is the direct intellectual
source for Componode's `PLATFORM` product type and `CONSUMES_FROM` edge —
a platform product exists to be consumed by other products, and the
consumption relationship is categorically different from composition.

## 3. ServiceNow CSDM / CMDB (the heavyweight benchmark)

Sources: [CSDM 5.0 white paper (PDF)](https://www.servicenow.com/community/s/cgfwn76974/attachments/cgfwn76974/common-service-data-model-kb/744/2/CSDM%205.pdf),
[CSDM 3.0 white paper (PDF)](https://www.configuretek.com/wp-content/uploads/2023/04/Common-Service-Data-Model-CSDM-3.0-White-Paper.pdf),
[servicenow.com CSDM product page](https://www.servicenow.com/products/it-operations-management/what-is-csdm.html),
[CMDB schema model docs](https://www.servicenow.com/docs/r/de-DE/servicenow-platform/configuration-management-database-cmdb/c_ConfigurationManagementDatabase.html),
plus community sources marked [secondary].

- **The model in one paragraph**: CSDM organizes data into domains —
  Foundation, Design (used by APM), Build (added in CSDM 4.0), Manage
  Technical Services, and Sell/Consume — with "Manage Portfolio" spanning
  them. Three out-of-box *service types*: application, business, technical.
  Core records: Business Application, Application Service
  (`cmdb_ci_service_auto`), Business Service, Service Offering
  (`service_offering`), Technical Service, plus foundation data (Company,
  Business Unit, Department, Location, Group, User)
  ([CSDM 3.0 white paper](https://www.configuretek.com/wp-content/uploads/2023/04/Common-Service-Data-Model-CSDM-3.0-White-Paper.pdf);
  [The Cloud People: CSDM 4.0 changes](https://www.thecloudpeople.com/blog/common-service-data-model-what-has-changed)
  **[secondary]**; [application services docs](https://www.servicenow.com/docs/r//xanadu/servicenow-platform/configuration-management-database-cmdb/application-services.html)).
- **CSDM 5.0 adopts "Digital Product"**: "a cornerstone of CSDM 5 is the
  introduction of digital products … the concept of Business Applications
  will still be valid, but the label will change to 'Digital Products'",
  explicitly derived from Open Group IT4IT
  **[secondary — Einar & Partners Research Unit](https://research.einar.partners/the-ultimate-csdm-5-0-guide-to-digital-products/)**.
- **Scale of the metamodel**: the `cmdb_ci` class tree has ~460 CI classes
  defined out-of-box on a current release (a live-instance count found "460
  classes defined, but only 35 actually contain data"; a community answer
  cites "about 700 tables when all applications that use it are active")
  **[secondary — note.com instance analysis](https://note.com/u_sn_notes/n/n5c05662a44d0?hl=en)**,
  **[secondary — ServiceNow community](https://www.servicenow.com/community/itom-forum/list-of-all-cmdb-classes-attributes/m-p/1016327)**.
- **Why it is considered complex to implement** — in the sources' own words:
  - *Phased rollout is mandatory*: ServiceNow itself prescribes a
    "Foundation > Crawl > Walk > Run > Fly" progression; "the CSDM journey
    is never the same" per customer and "forcing a 'by-the-book' model too
    early often leads to resistance and poor adoption"
    **[secondary — ServiceNow community](https://www.servicenow.com/community/cmdb-forum/implementing-csdm/m-p/3451158)**,
    **[community developer blog](https://www.servicenow.com/community/developer-blog/csdm-migration-from-custom-service-management/ba-p/3152189)**.
  - *It's organizational, not technical*: "CSDM is not a project you finish.
    It's a direction you commit to … [each] stage requires service
    ownership — named humans accountable for maintaining service
    relationships, not just infrastructure records. That accountability
    shift is harder than the technical work"
    **[secondary — ServiceNow community](https://www.servicenow.com/community/developer-blog/csdm-is-not-a-project-you-finish-it-s-a-direction-you-commit-to/ba-p/3506920)**.
  - *Vocabulary mismatch*: "One of the biggest challenges consistently lies
    in definitions. Customers often use familiar terms that mean something
    different in CSDM" — e.g. Business Application vs Application Service vs
    Business Service Offering vs Technical Service Offering
    **[secondary — ServiceNow community](https://www.servicenow.com/community/cmdb-forum/implementing-csdm/m-p/3451158)**.
  - *Foundation-data prerequisite*: the white paper requires a working
    session on trusted data sources, change frequency, and data stewards
    *before* modeling ("Who will maintain the data?")
    ([CSDM 5.0 white paper](https://www.servicenow.com/community/s/cgfwn76974/attachments/cgfwn76974/common-service-data-model-kb/744/2/CSDM%205.pdf)).
  - *Vendor admits big-bang failure mode*: "CMDB implementations typically
    fail because people aren't clear on their objectives or try to go for a
    'big bang' approach" — from ServiceNow's own CMDB design guidance
    ([wp-cmdb-design-guidance.pdf](https://www.servicenow.com/content/dam/servicenow-assets/public/en-us/doc-type/resource-center/white-paper/wp-cmdb-design-guidance.pdf)).
  - *Discovery drift*: discovery/import generates thousands of CIs "nobody
    named or owns" — on the sampled live instance only 0.09 relationships
    per CI existed, i.e. "the majority of CIs are not connected to
    anything"
    **[secondary — note.com instance analysis](https://note.com/u_sn_notes/n/n5c05662a44d0?hl=en)**;
    corroborated by
    **[flowtux.com CMDB article](https://flowtux.com/blog/does-a-lean-team-need-a-cmdb) [secondary]**:
    "a stale entry does not simply fail to help; it actively misleads
    whoever trusted it."
  - *Two implementation lenses that don't quite line up*: CSDM offers an
    "Application focus" and a "Service focus"; "most CSDM documentation is
    oriented towards the Service focus, leaving gaps in guidance for those
    following the Application focus"
    **[secondary — The Cloud People](https://www.thecloudpeople.com/blog/implementing-csdm-into-servicenow)**.

**Relevance to Componode**: CSDM is the canonical "heavy" DPAM. Its
Business Application ≈ Componode Digital Product; its CI ≈ Componode
Component; its discovered service instance ≈ ComponentInstance. The
complexity lessons are directly applicable: importer noise needs a
curation layer (Componode's human-curated product hierarchy + Component
Groups), and ownership must be federated to named humans, not a central
team.

## 4. SAP LeanIX / Enterprise Architecture Management (the metamodel approach)

Sources: [SAP Learning: Understanding the Meta Model](https://learning.sap.com/courses/learning-to-use-sap-leanix-for-successful-enterprise-architecture/understanding-the-sap-leanix-meta-model_ca7862d4-8661-485d-b14b-738fb3da6cba),
[Configuring Key Features of the Meta Model](https://learning.sap.com/courses/mastering-advanced-sap-leanix-knowledge-for-enterprise-architecture-success/configuring-key-features-of-the-meta-model_b7d32dac-67ce-44b4-b962-dcbe7d705d44),
[leanix.net EA modeling wiki](https://www.leanix.net/en/wiki/ea/enterprise-architecture-modeling),
[leanix.net data quality wiki](https://www.leanix.net/en/wiki/ea/enterprise-architecture-data-quality).

- **The Fact Sheet is the single object type**; the *metamodel* has 4
  conceptual layers × 12 default fact-sheet types: Objective, Platform,
  Initiative | Organization, Business Capability, Business Context |
  Application, Interface, Data Object | IT Component, Tech Category,
  Provider (System optional)
  ([SAP Learning meta model course](https://learning.sap.com/courses/mastering-advanced-sap-leanix-knowledge-for-enterprise-architecture-success/configuring-key-features-of-the-meta-model_b7d32dac-67ce-44b4-b962-dcbe7d705d44);
  corroborated by
  **[secondary — Linked.Archi LeanIX ontology](https://meta.linked.archi/docs/guide/ontology-reference/)**).
- **Application is the pivot**: "Applications sit at the center of the meta
  model, acting as the key linking element between business and IT. They
  support business capabilities, run on IT components, are used by
  organizations, and are governed by initiatives"
  ([SAP Learning](https://learning.sap.com/courses/mastering-advanced-sap-leanix-knowledge-for-enterprise-architecture-success/configuring-key-features-of-the-meta-model_b7d32dac-67ce-44b4-b962-dcbe7d705d44)).
- **~16 typed relations** between fact-sheet types (supports, requires,
  hasInterface, consumesInterface, parentOf, partOfPlatform, providedBy,
  categorizedBy, etc.) — every relation name is derived from the
  source→target type pair
  **[secondary — Linked.Archi ontology reference](https://meta.linked.archi/docs/guide/ontology-reference/)**.
- **Adoption friction is documented by LeanIX itself**: data degrades via
  (a) "centralized maintenance in a distributed environment" — a 2–3 person
  EA team cannot know every application's criticality/lifecycle; (b) "the
  snapshot problem" — manual surveys go stale immediately; (c) "abandonment
  under load" — "when maintaining a fact sheet requires coordinating with
  the EA team, submitting change requests, or navigating a tool that
  requires architectural expertise, application owners disengage"
  ([leanix.net data quality wiki](https://www.leanix.net/en/wiki/ea/enterprise-architecture-data-quality)).
- **The vendor's own mitigation is minimality**: "It's better to have 80%
  of the critical portfolio covered with accurate data than a bloated model
  with limited usability" and capability maps should have "no more than two
  levels" because "managing more hierarchies … results in slower adoption"
  ([leanix.net adoption wiki](https://www.leanix.net/en/wiki/ea/enterprise-architecture-and-ea-tool-adoption);
  [SAP Learning: repeating key fact sheet types](https://learning.sap.com/courses/sap-leanix/repeating-the-key-fact-sheet-types)).
- **Data-quality governance is a feature tax**: Quality Seals
  (check-needed/approved/draft/rejected states that "break" when a
  non-owner edits), Subscription Roles for distributed ownership, mandatory
  fields per fact-sheet type — real mechanisms that exist *because*
  metamodel-driven inventories rot without them
  ([SAP Learning: data quality](https://learning.sap.com/courses/adding-first-data-to-your-sap-leanix-workspace/data-quality-with-sap-leanix);
  [maintaining data](https://learning.sap.com/courses/presenting-sap-leanix-for-fact-sheet-owners/maintaining-data-ensuring-continuous-data-quality)).

**Relevance to Componode**: LeanIX validates the product-level concepts
(Business Capability, Platform, Application ↔ Component/IT Component) but
warns that even 12 object types + 16 relations is enough to trigger
"managing more hierarchies can be complex to maintain." Componode's
~half-dozen curated entities is well under this threshold. Note also:
LeanIX `Platform` is a *grouping* fact sheet ("groups capabilities,
applications, and technologies") — a structural analog of Componode's
`PLATFORM` type.

## 5. Practical internal developer portals: Port, OpsLevel, Cortex

### 5.1 Port — user-defined blueprints

Source: [docs.port.io data model](https://docs.port.io/context-lake/data-model/configure-data-model/),
[set up blueprints](https://docs.port.io/context-lake/data-model/setup-blueprint/overview/),
[relate blueprints](https://docs.port.io/context-lake/data-model/setup-blueprint/relate-blueprints/),
[adoption strategy guide](https://www.port.io/guide/adoption-strategy).

- **No fixed metamodel at all.** "Blueprints are the basic building block
  of your data model — each one represents an asset in your organization …
  completely customizable"; each blueprint is a JSON schema of properties
  plus *relations* (`{target, required, many}`) to other blueprints
  ([configure-data-model](https://docs.port.io/context-lake/data-model/configure-data-model/);
  [relate-blueprints](https://docs.port.io/context-lake/data-model/setup-blueprint/relate-blueprints/)).
- **Scorecards are the governance mechanism**: "Scorecards define standards
  as rules evaluated continuously against the catalog" — e.g. "services
  must have owners … production services require 80% test coverage"
  ([docs.port.io — Why Port](https://docs.port.io/solutions/engineering-intelligence/why-port/)).
- **Adoption guidance mirrors the lightweight philosophy**: pitfalls are
  portals that "don't integrate into [developer] workflows," "starting with
  too many features," and big-bang launches; recommended rollout is "an
  iterative, stepwise approach" with "an initial focused use case"
  ([port.io adoption strategy](https://www.port.io/guide/adoption-strategy)).

### 5.2 OpsLevel — single Service entity + maturity rubric

Source: [opslevel.com service catalog](https://www.opslevel.com/discover/service-catalog),
[docs.opslevel.com scorecards](https://docs.opslevel.com/docs/scorecards),
[checks and filters](https://docs.opslevel.com/docs/checks-and-filters),
[maturity report](https://docs.opslevel.com/docs/service-maturity-report).

- **One central entity**: the *Service*, described with discriminator
  fields (tier, lifecycle, language, framework, `product`, `system`) rather
  than a typed hierarchy — `product` is explicitly "an application that
  your end user interacts with. Multiple services can work together to
  power a single product" (via the Terraform provider schema; see
  `component_taxonomy_research.md` §2.3 for the same citation).
- **Health = rubric levels, not status fields**: an org-wide Rubric
  (levels like Bronze/Silver/Gold across categories such as Security,
  Reliability) is evaluated by automated Checks ("from a simple ownership
  Check that makes sure none of your services are orphaned to … custom
  integration Checks"); team-scoped Scorecards are "lightweight Rubrics"
  for local standards; Campaigns push cross-cutting upgrades
  ([scorecards](https://docs.opslevel.com/docs/scorecards);
  [checks](https://docs.opslevel.com/docs/checks-and-filters);
  [opslevel.com maturity](https://www.opslevel.com/product/maturity)).
- **Explicitly sells low time-to-value**: "Launch your service catalog in
  days, not months … 30–45 days to full rollout," "automated catalog
  creation and maintenance"
  ([opslevel.com service catalog](https://www.opslevel.com/discover/service-catalog)) —
  marketing positioning, but evidence that *setup hassle* is the
  competitive axis in this market.

### 5.3 Cortex — default types + scorecards + hierarchical domains

Source: [docs.cortex.io entities overview](https://docs.cortex.io/ingesting-data-into-cortex/entities-overview),
[catalogs overview](https://docs.cortex.io/ingesting-data-into-cortex/catalogs),
[scorecards overview](https://docs.cortex.io/standardize/scorecards).

- **Four built-in entity types**: Services ("codebase-like modules" —
  microservices, libraries, components), Domains ("group entities into
  logical units … product areas, business capabilities, system
  boundaries"), Teams (ownership/membership), Cloud resources (synced from
  AWS/Azure/GCP); custom types allowed via YAML + JSON schema
  ([entities overview](https://docs.cortex.io/ingesting-data-into-cortex/entities-overview)).
- **Hierarchy lives in Domains, not the service type system**: the built-in
  Domains catalog "displays [entities] in a hierarchical view"; entities
  "can own other entities, depend on each other, and roll up into
  higher-level groupings"
  ([catalogs](https://docs.cortex.io/ingesting-data-into-cortex/catalogs);
  [quick start](https://docs.cortex.io/get-started/quickstart)).
- **Scorecard anatomy = entities + rules + levels/points + evaluation
  window** (default re-check every 4 hours): "You write down what 'good'
  looks like once, and Cortex tells you which entities meet that bar" —
  e.g. "it has an owner, it has a runbook … it has no critical
  vulnerabilities"
  ([scorecards overview](https://docs.cortex.io/standardize/scorecards)).

**Relevance to Componode**: All three practical portals answer "is this
thing healthy?" with *evaluated rules/scorecards*, and all three treat
**ownership presence** as a first-class checkable standard (OpsLevel's
canonical example Check is literally "no orphaned services"). Componode's
derived product health rollup from instance status is a simpler cousin:
operational truth (instance status) rolled up rather than compliance
rules — a deliberate trade: less gamification, zero rule-authoring burden.

## 6. Open Group: DPBoK and IT4IT (the standards-level definition)

Sources: [pubs.opengroup.org/dpbok/standard/DPBoK.html](https://pubs.opengroup.org/dpbok/standard/DPBoK.html),
[IT4IT 3.0 — Digital Product chapter](https://pubs.opengroup.org/it4it/3.0/standard/Digital_Product.html),
[Managing Digital — Product Management chapter](https://pubs.opengroup.org/theopengrouppress/managing-digital/product-mgmt-chap.html),
[DPBoK community edition PDF](https://blog.opengroup.org/wp-content/uploads/2020/04/dpbok-ce.pdf).

- **IT4IT 3.0 defines Digital Product as "the single, simple, unifying
  entity referenced over the full management lifecycle and across all the
  value streams"** — deliberately "one abstract unifying term … to
  consolidate the management aspects required for 'application,' 'service,'
  and 'product'"
  ([IT4IT Digital Product chapter](https://pubs.opengroup.org/it4it/3.0/standard/Digital_Product.html)).
- **Formal definition** (quoted verbatim in secondary coverage of the
  standard): "A 'digital product' is a service, physical item or digital
  item that provides an agreed and specific outcome for a consumer, and
  that incorporates and requires software to realize an outcome"
  **[secondary — Einar & Partners, quoting the Open Group](https://research.einar.partners/the-ultimate-csdm-5-0-guide-to-digital-products/)**;
  the primary URL is
  [pubs.opengroup.org/it4it/3.0/standard/Digital_Product.html](https://pubs.opengroup.org/it4it/3.0/standard/Digital_Product.html)
  (not directly retrievable; excerpt confirmed the chapter exists and
  contains §4.2 "Digital Product Definition").
- **Rationale = the industry shift to product**: "as this thinking has
  matured, a 'shift to product' has become a mainstream objective in IT
  strategy" — affecting "financial planning, value management, organization
  around Agile/DevOps teams"
  ([IT4IT 3.0 book front matter](https://download.boekhuis.nl/9789401809429_fragm-docb.pdf)).
- **DPBoK** is a body of knowledge for practitioners, organized by
  organization scale ("Contexts" I–IV: Individual/Founder → Team →
  Team of Teams → Enduring Enterprise); its product management chapter
  adopts the plain dictionary definition — a product is anything that
  "serves a need or satisfies a want" for a consumer
  ([DPBoK standard](https://pubs.opengroup.org/dpbok/standard/DPBoK.html);
  [Managing Digital ch. 4](https://pubs.opengroup.org/theopengrouppress/managing-digital/product-mgmt-chap.html);
  [DPBoK community edition](https://theopengroup.gitlab.io/dpbok-community-edition/html/DPBoK-CE.html)).

**Relevance to Componode**: "Digital Product" is now a *standard term with
a standard definition*, and the IT4IT definition's key properties —
**consumer**, **agreed outcome**, **requires software** — map onto
Componode's model almost directly (owner ↔ accountable party; type +
consumer ↔ who it's for; DEPENDS_ON components ↔ "requires software to
realize an outcome"). Componode's vocabulary choice is well aligned.

## 7. Application Portfolio Management practice (what the minimal field set actually is)

Sources: [Gartner TIME via LeanIX wiki](https://www.leanix.net/en/wiki/apm/gartner-time-model),
[LeanIX TIME e-book](https://www.leanix.net/en/download/applying-the-gartner-time-framework-for-application-rationalization),
[AWS CAF governance perspective](https://docs.aws.amazon.com/whitepapers/latest/aws-caf-governance-perspective/application-portfolio-management.html),
[Umbrex APM playbook — minimum viable inventory](https://umbrex.com/resources/application-portfolio-rationalization-playbook/building-the-application-inventory/),
[Sparx APM hands-on guide](https://www.sparxsystems.us/application-portfolio-management/getting-started-with-apm-hands-on-guide/),
[ServiceNow APM community best practices](https://www.servicenow.com/community/apm-forum/application-portfolio-management-inventory-best-practices/m-p/1016198).

- **TIME model**: applications are scored on *functional fit* (how well it
  serves business capabilities) × *technical fit* (quality, maintainability)
  and classified **Tolerate / Invest / Migrate / Eliminate** — "the industry
  standard for planning and executing an application rationalization"
  ([LeanIX TIME wiki](https://www.leanix.net/en/wiki/apm/gartner-time-model);
  [SAP Learning TIME decisions](https://learning.sap.com/courses/getting-your-stakeholders-on-board-enriching-data-and-taking-first-decisions/generate-insights-and-take-time-decisions-1)).
- **The documented "minimum viable inventory"** (Umbrex playbook):
  - *Identity*: name, alternate names, **stable unique ID**, vendor/builder,
    version, short description.
  - *Ownership*: "a named business owner and a named technology owner … If
    either owner cannot be named, that absence is itself a meaningful data
    point. Ownerless applications are usually among the hardest to retire
    and the most weakly governed."
  - *Business context*: primary business capability, user groups,
    geography, "a simple assessment of criticality."
  - (Plus cost and lifecycle in the fuller template — "the smallest
    practical dataset that allows a rationalization team to see what
    exists, who owns it, how important it is, what it costs, and where
    risk or duplication may justify action.")
  ([Umbrex playbook](https://umbrex.com/resources/application-portfolio-rationalization-playbook/building-the-application-inventory/)).
- **A 30-day practical recipe** (Sparx): spreadsheet columns = "application
  name, its main purpose, the business owner, the IT owner, cost center,
  the business capability it supports, annual cost, and lifecycle stage
  (e.g., active, sunsetting, end-of-life)"; then dedupe, import, and "group
  the applications by the business capability they support"
  ([Sparx APM guide](https://www.sparxsystems.us/application-portfolio-management/getting-started-with-apm-hands-on-guide/)).
- **AWS CAF guidance** aligns: "Assign business-related metadata, such as
  business criticality, business purpose, and business owner" plus a
  "technology owner that will be responsible to periodically enrich and
  validate application metadata in collaboration with a business owner"
  ([AWS whitepaper](https://docs.aws.amazon.com/whitepapers/latest/aws-caf-governance-perspective/application-portfolio-management.html)).
- **Federated dual ownership is the consensus failure-prevention pattern**:
  "a minimum of 2 owners of each Business Application is required: one
  business owner and one IT owner … Not federating the ownership is the
  most common failure point of an APM practice"
  **[secondary — ServiceNow APM community](https://www.servicenow.com/community/apm-forum/application-portfolio-management-inventory-best-practices/m-p/1016198)**.
- **Spreadsheet-class tooling is legitimate at small scale**: "A
  spreadsheet with 30 essential fields for 50 high-priority applications
  provides more value than an elaborate tool with empty records"; a
  three-point keep/review/eliminate scale "produces actionable results
  without elaborate frameworks"
  **[secondary — nfpstack.com APM guide](https://www.nfpstack.com/docs/applications/application-management/application-portfolio-management/)**.

**Relevance to Componode**: This is the strongest external validation of
Componode's product field set. The documented minimum — stable ID/slug,
business + technical ownership, capability linkage, criticality, lifecycle
+ EOL — corresponds to Componode's slug, LineOfBusiness/Team/Person chain,
BUSINESS_CAPABILITY type, criticality field, and sunset date.

## 8. Product operating model (what practitioners agree a digital product needs)

Sources: [SVPG Empowered Product Teams](https://www.svpg.com/empowered-product-teams/),
[SVPG Changing How You Solve Problems](https://www.svpg.com/changing-how-you-solve-problems/),
[Wiley — TRANSFORMED](https://www.wiley.com/en-us/transformed-moving-to-the-product-operating-model-p-9781119697398),
[Thoughtworks product operating model article](https://www.thoughtworks.com/insights/articles/how-to-create-a-product-operating-model-to-support-product-organization-transformation),
[martinfowler.com Products over Projects](https://martinfowler.com/articles/products-over-projects.html).

- **Outcome over output**: empowered teams are "assigned problems to solve,
  rather than given lists of features to build … accountable to deliver
  business results (outcomes) rather than shipping features (output)" —
  and a solution must be *valuable, usable, feasible, viable*
  ([SVPG](https://www.svpg.com/changing-how-you-solve-problems/);
  [SVPG empowered teams](https://www.svpg.com/empowered-product-teams/)).
- **Durable ownership**: "Product-mode instead uses durable,
  ideate-build-run teams working on a persistent business issue" — as
  opposed to temporary project teams funded by business case
  ([martinfowler.com](https://martinfowler.com/articles/products-over-projects.html)).
- **Product Operating Model definition**: "defines how you design, develop,
  deliver and manage products throughout their lifecycle … how the various
  components of your organization work together to execute the strategy and
  deliver value to customers, users and the business"
  ([Thoughtworks](https://www.thoughtworks.com/insights/articles/how-to-create-a-product-operating-model-to-support-product-organization-transformation)).
- **Consensus minimum for "a digital product"** (synthesized across SVPG,
  Thoughtworks, IT4IT): a persistent thing with (a) a **clear owner** (a
  durable team, not a project), (b) a **consumer/customer** (explicit —
  internal consumers count), (c) a **measurable outcome** it exists to
  produce (not a feature list), (d) an **ongoing lifecycle** (evolves until
  deliberately retired — the "run" in ideate-build-run).

**Relevance to Componode**: Componode's Digital Product satisfies (a), (b),
and (d) structurally; (c) — the measurable outcome — is the one
practitioner-agreed property Componode carries only implicitly (via
description/links). A free-text "outcome/value statement" field would be
the cheapest possible alignment with the product-operating-model
literature.

---

## 9. Comparative table

| Tool | "Product-ish" concept | Composition / hierarchy | Ownership | Health / maturity | Complexity verdict |
|---|---|---|---|---|---|
| **Backstage** | Component (+ System, Domain groupings) | `dependsOn`/`providesApis`/`consumesApis` edges; System→Domain nesting | Single required `spec.owner` ref → Group/User | None in core (plugins); `spec.lifecycle` = maturity enum only | **Lightweight.** ~7 kinds, YAML in git, annotation-bag extensibility. Deliberately excludes environments/CMDB scope |
| **Team Topologies** (practice, not tool) | Platform-as-product; stream-aligned product | Platform team ↔ stream-aligned teams via "X-as-a-Service" | Team owns a slice end-to-end ("you build it, you run it") | N/A — org design pattern | **Lightweight conceptual.** 4 team types + 3 interaction modes; "thinnest viable platform" |
| **ServiceNow CSDM** | Business Application → being relabeled "Digital Product" (CSDM 5) | Business App → Application Service → CIs; Business Service Offering vs Technical Service Offering; ~460 CI classes | Federated data stewards + business/IT owners; foundation data tables | CMDB health dashboards, service maps | **Heavyweight.** ~700-table model, 5 domains, mandatory crawl-walk-run-fly, certified consultants, vocabulary training |
| **SAP LeanIX** | Application fact sheet (Business Application subtype); Business Capability; Platform | Typed relations (~16): supports, requires, partOfPlatform, parentOf hierarchies | Subscription roles per fact sheet; quality seals enforce owner re-approval | Quality seals, completeness metrics, lifecycle/TIME reports | **Medium-heavy.** 12 fact-sheet types is small for EA but still requires EA-literacy; documented "abandonment under load" |
| **Port** | Whatever blueprint you define (default `service`) | User-defined relations `{target, many}` | Blueprint-defined (usually `owned_by` → team relation) | Scorecards = continuous rule evaluation | **Lightweight-medium.** No fixed metamodel = flexible, but you design the model yourself |
| **OpsLevel** | Service; `product` field = end-user app composed of services | `system`/`product` grouping fields; dependencies | Team entity ownership; orphan-detection is a first-class Check | Rubric levels (Bronze→Gold) via automated Checks + Campaigns | **Lightweight.** Single central entity + discriminator fields; "30–45 days to rollout" positioning |
| **Cortex** | Service (default); Domain for product areas/capabilities | Domains = hierarchical rollups; entity `owns`/`dependsOn` | Team entities + leaderboard | Scorecards: entities×rules×levels/points, re-evaluated ~4h | **Lightweight-medium.** 4 default types + YAML-defined custom types |
| **Componode** | DigitalProduct (3-type enum) | COMPOSES DAG + CONSUMES_FROM (platform) + DEPENDS_ON → Components | LoB → Team → Person chain | Derived rollup from ComponentInstance status | **Lightweight** — smaller than Backstage on the product side; more opinionated than Port, far smaller than CSDM/LeanIX |

## What makes vendor approaches heavy

Concrete mechanisms, each cited above:

1. **Mandatory certified metamodel conformance** — CSDM prescribes domains,
   service classifications, and "correct" tables for each persona;
   non-conformance breaks ITSM/ITOM/APM product features (§3).
2. **Hundreds of object types** — ~460 out-of-box CI classes / ~700 CMDB
   tables (§3); even LeanIX's "lean" EA model ships 12 fact-sheet types ×
   ~16 typed relations (§4).
3. **Vocabulary training barrier** — customers must learn CSDM-specific
   meanings for familiar words (Business Application vs Application Service
   vs Service Offering); practitioners cite "definitions" as the biggest
   adoption challenge (§3).
4. **Multi-phase rollout programs** — Foundation→Crawl→Walk→Run→Fly
   maturity staging; "not a project you finish" (§3).
5. **Data-steward workflow machinery** — Quality Seals that break on
   non-owner edits, subscription roles, mandatory-field configuration per
   type, periodic surveys (§4) — governance features that exist to
   *compensate for* the maintenance burden the metamodel creates.
6. **Foundation-data prerequisites** — trusted-source analysis, data
   stewards, org/location/user master data *before* any value (§3).
7. **Discovery-noise cleanup** — auto-discovered CIs arrive unnamed,
   unowned, unconnected (0.09 relationships/CI observed), requiring ongoing
   reconciliation labor (§3).
8. **Central-bottleneck maintenance** — EA-team-mediated updates cause
   "abandonment under load"; the fix is federated ownership, which is
   itself a change-management program (§4).

## What the practical minimum looks like

Synthesized across Backstage, Port/OpsLevel/Cortex, APM practitioners,
IT4IT, and Team Topologies — the smallest set that still answers "what do
we have, who owns it, what depends on what, and is it healthy?":

1. **One product-level entity** with: stable ID/slug, name, description,
   **named owner(s)** (consensus: business + technical), **lifecycle stage**
   (incl. a planned-end/sunset date), **criticality**, and free-form
   links/tags. (APM minimum-viable inventory, §7; IT4IT outcome/consumer
   framing, §6.)
2. **A small closed product-type set** (capability / platform /
   customer-facing is defensible; Backstage's open `spec.type` shows a free
   string also works — the enum is for *rendering and rules*, not
   correctness) (§1, §10).
3. **Two product→product edge semantics**, not one generic "related-to":
   *composition* (part-of, rendered as a tree, acyclic) vs *consumption*
   (uses a shared platform offering — the Team Topologies "X-as-a-Service"
   distinction) (§2).
4. **Product→component edges** so the curated layer connects to discovered
   reality (LeanIX's Application→IT Component `requires`; OpsLevel
   product→services) (§4, §5).
5. **Discovered component layer separated from the curated layer** —
   importer/discovered noise must not corrupt the human-authored product
   graph (CSDM discovery-drift lesson, §3; Port/OpsLevel auto-cataloging
   proves automation is expected, §5).
6. **Environment as separate instance records**, never a field — confirmed
   by `component_taxonomy_research.md` (ServiceNow design-parent→instance,
   Humanitec resource-per-env) and re-confirmed here by Backstage's
   environment-agnostic model (§1).
7. **One health signal, computed, not maintained**: either a scorecard/rule
   engine (OpsLevel/Cortex/Port) or an operational rollup from instance
   status (Componode). Nobody recommends a hand-maintained "health" field
   (§5).
8. **Federated editing with a tiny governance loop**: owners update their
   own products; staleness is visible (LeanIX's quality seal is the heavy
   version; "owner can't be named" being a data point is the light one)
   (§4, §7).
9. **Deliberate non-goals**: no cost accounting, no risk/compliance
   registers, no workflow approvals, no certified taxonomy — each is a
   known adoption-killer at small scale (§3, §4, §7).

## 10. Conflicts and notes vs. Componode's existing model

- **3-type product enum (BUSINESS_CAPABILITY / PLATFORM / CUSTOMER_FACING)**:
  **no surveyed tool ships this exact enum**, but none contradicts it
  either. Closest analogs: LeanIX splits these into *separate fact-sheet
  types* (Business Capability, Platform, Application); Team Topologies
  distinguishes stream-aligned products from platform products at the *team*
  level; IT4IT/CSDM treat consumer-facing vs internal as a lifecycle/consumer
  attribute, not a type. Componode's enum is a valid compression — the one
  risk is that `CUSTOMER_FACING` is a *consumer* attribute while the other
  two are *structural* attributes, a mild axis-mixing no external source
  resolves. (Informational; does not conflict with any ADR.)
- **Dual ownership validated**: APM consensus is business owner + IT owner
  (§7); Componode's LoB→Team→Person chain plus optional per-entity owner
  covers this. Backstage's "one ultimate owner" rule (§1) is the opposing
  simplification — Componode allows both granularities.
- **COMPOSES-as-DAG is industry-consistent**: LeanIX `parentOf`, Cortex
  domain hierarchies, and Backstage `subcomponentOf`/`system`/`domain` are
  all acyclic containment; **no source surveyed uses a cyclic product
  graph** — the 409 CYCLE rejection (ADR-049/050) matches universal
  practice.
- **CONSUMES_FROM has a direct analog**: Team Topologies' X-as-a-Service
  (§2) and LeanIX's platform-membership/service-offering relations (§4)
  both distinguish *consuming a shared offering* from *containment*.
  Restricting CONSUMES_FROM targets to PLATFORM (ADR-018) mirrors Team
  Topologies' rule that only platform teams offer "as-a-Service."
- **Health rollup**: the industry norm is *rule/scorecard evaluation*
  (OpsLevel rubrics, Cortex scorecards, Port scorecards); Componode's
  operational-status rollup is simpler and complementary, not contradictory.
  If Componode later wants scorecard-style maturity, the sources show the
  pattern: entities × declarative rules × ordered levels.
- **Environment**: re-validated — nobody puts env on the logical asset;
  it's always a separate record or omitted entirely (Backstage). The
  ComponentInstance design (ADR-014/034) is orthodox.
- **Lifecycle vs status**: re-validated — Backstage `lifecycle` is
  maturity, not environment; CSDM uses paired `life_cycle_stage` /
  `life_cycle_stage_status`; Componode's `Component.lifecycle`
  (ACTIVE/RETIRED) vs `ComponentInstance.status` (RUNNING/…) split is the
  same two-axis pattern.
- **Sunset date**: maps to LeanIX/APM lifecycle dates and the TIME
  "Eliminate/Migrate" trigger — orthodox.
- **Gap candidates** (not adopted recommendations — flagging for future
  specs): (a) a free-text **outcome/value statement** on DigitalProduct
  (IT4IT "agreed and specific outcome"; SVPG outcomes-over-output, §6, §8);
  (b) **explicit consumer field** on PLATFORM products (Team Topologies:
  platforms are defined by having internal customers, §2);
  (c) optional **cost** field — every APM minimum list includes it but
  Componode omits it (§7) — low priority, easily added later.
- **"Digital Product" naming is standard-aligned**: IT4IT 3.0's formal
  definition and ServiceNow CSDM 5.0's adoption of the term mean Componode's
  central noun is the emerging industry standard, not an idiosyncrasy (§3, §6).

---

## Appendix — Source tier notes

- **Could not fetch pages directly** (sandbox); all official-doc claims
  rely on search-indexed excerpts of the cited URL. Quotes shown are
  verbatim excerpts returned by the index.
- **[secondary]** marks community forums, vendor-adjacent blogs, and
  third-party analyses used where the primary doc was a PDF, behind
  certification paywalls, or unindexed.
- Highest-confidence claims (official docs, directly excerpted):
  Backstage system model & descriptor format; Port data-model docs;
  Cortex entities/scorecards docs; OpsLevel scorecards docs; SAP Learning
  LeanIX meta-model pages; leanix.net data-quality wiki; AWS CAF
  whitepaper; IT4IT chapter page.
- Lower-confidence (secondary, corroborating): the ~460/700 CMDB class
  counts; the IT4IT digital-product definition wording; CSDM 5.0
  "Digital Product" relabeling; specific CSDM rollout anecdotes.
