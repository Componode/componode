# Research: Importer Source Migration (spec 045)

**Status**: Complete — all decisions resolved; no NEEDS CLARIFICATION
remain.

## Decision 1 — Per-importer source identity keys

**Decision**: adopt the provider-native mapping below; each importer
declares `reportsSourceIdentity: true` and calls
`context.reportSourceIdentity()` before the first yield — including
empty inventories.

| Importer | `externalIdentity` | How obtained | Notes |
|---|---|---|---|
| github | `{canonicalBaseUrl}#org:{orgId}` | `octokit.rest.orgs.get({org})` moved to run start, before any yield | `baseUrl` defaults to `https://api.github.com`; label = org login |
| aws | `sourceKey` (admin-supplied) | new optional config scope key — **required in practice**: runs fail without it | stub importer — no AWS SDK, no secrets; adding an SDK is out of scope |
| azure | `subscriptionId` else `sourceKey` | existing config key, or the new scope key | `subscriptionId` already drives externalIds |
| alibaba-cloud | `identity.accountId` | `client.getCallerIdentity()` — **already fetched pre-yield** at `importer.ts:39` | one-line report; ARN-carrying assets unchanged |
| kubernetes | canonical `endpoint` else `sourceKey` | existing optional `endpoint` or new scope key | stub importer — no k8s client; kube-system UID needs a client+secrets (out of scope) |
| api-url | canonical `config.url` | existing required config key | `canonicalizeSourceIdentity` strips userinfo/auth params/fragments |
| web-url | canonical `config.url` | same | same |
| mcp-server | canonical `endpoint` else `sourceKey` | existing optional `endpoint` or new scope key | endpoint-less configs need `sourceKey` |

**Rationale**: matches the wave document's approved mapping (GitHub org
ID + base URL, cloud account/subscription identity, cluster identity,
canonical URL) and ADR-119 #1's fallback (admin-supplied stable key only
where the provider offers no trustworthy identity). For the four stub
importers (aws, azure, kubernetes, mcp-server) no SDK/credential path
exists today — inventing one would pull real provider work into a
migration spec; config-derived identity plus the `sourceKey` fallback
keeps the contract honest.

**Alternatives considered**: (a) adding provider SDKs to stubs for real
identity calls — rejected: huge scope expansion, secrets/model changes,
no catalog value for synthetic assets; (b) leaving stubs on legacy
reconciliation — rejected: spec requires 8/8 adoption; (c) deriving
identity from config labels — rejected: ADR-119 forbids matching by
display name.

## Decision 2 — `sourceKey` scope field

**Decision**: one optional scope key, `sourceKey`, added to the config
schemas of the four importers that can lack derivable identity
(`importer-aws`, `importer-kubernetes`, `importer-mcp-server`,
`importer-azure` for the subscription-less case). Non-empty trimmed
string; used verbatim as `externalIdentity` when the provider-native key
is absent.

**Rationale**: uniform escape hatch — one documented key instead of four
bespoke names; lives in scope (not secrets) because identity is
non-secret by definition (ADR-119 #1).

**Alternatives considered**: per-importer key names (rejected —
inconsistent operator UX); making it a shared manifest-driven field
(deferred — config schemas already enumerate scope keys; a shared
convention documented in ADR-120 is sufficient).

## Decision 3 — externalId qualification format

**Decision**: `{canonicalIdentity}::{nativeId}` — canonical source
identity, `::` separator, original native ID. Applied **only** where the
native ID is not globally unique:

| Importer | Qualify? | Result example |
|---|---|---|
| github | only when `baseUrl` ≠ api.github.com (GHES) | `ghes.corp.example::123` |
| aws | always | `acct-1::us-east-1:ec2:instance` |
| azure | only the `default:` form — emitted scope becomes the identity key | `sub-123::Microsoft.Compute/virtualMachines` (unchanged shape) |
| alibaba-cloud | only the non-ARN fallback | `1234..::ACS::ECS::Instance:i-…` |
| kubernetes | always | `cluster-a::default:apps/v1:Deployment` |
| api-url / web-url | never — the URL IS the identity | unchanged |
| mcp-server | always (endpoint-less form too) | `mcp-a::tools/list` |

Core gains `qualifyExternalId(identity, nativeId)` and
`legacyExternalId(qualifiedId)` helpers in `utils/source-identity.ts` so
the format is canonical in exactly one place.

**Rationale**: dedup is global on `(category, provider, externalId)`
(`import-run-service.ts:149–155`) — qualification inside `externalId` is
the only mechanism that both preserves cross-Source sharing (identical
qualified IDs merge) and prevents false merges (distinct systems never
produce the same qualified ID). The `::` separator is URL-safe-ish,
unambiguous in existing formats (none contain `::` except Alibaba's
`ACS::` prefix — which sits *after* the separator, never before it, so
split-on-first-`::` is safe).

**Alternatives considered**: (a) source-scoped dedup key
`(sourceId, externalId)` — rejected: it *prevents* legitimate sharing of
the same logical asset between Sources (ADR-119's two-daemon scenario
requires merge); (b) always-qualify every importer — rejected: needless
rekey churn on api-url/web-url/github.com rows; (c) per-importer bespoke
formats — rejected: one canonical format keeps `legacyExternalId`
derivation generic.

## Decision 4 — Continuity via adopt-on-report (not batch rekey, not dual-format matching)

**Decision**: when the qualified `externalId` lookup misses, the executor
computes `legacyExternalId(asset.externalId)` and looks up
`(category, provider, legacyId)` restricted to components with **no
membership from the reporting Source**. On match it updates the row's
`externalId` to the qualified form, proceeds with the normal upsert, and
stamps the membership — "adopted." Rows never re-reported keep their
stored externalId and `LEGACY_UNATTRIBUTED` provenance forever.

**Rationale**: satisfies both spec invariants at once — no duplicate for
the same logical asset (the row is updated, not inserted) and no batch
rekey of ambiguous records (adoption happens only when the live Source
reports the asset — the most defensible provenance possible). A second
Source reporting its own same-native-ID asset can no longer match the
adopted row (its externalId is now source-qualified), so previously
merged legacy rows disambiguate correctly over successive runs.

**Alternatives considered**: (a) batch rekey in migration 023 — rejected:
for aws/kubernetes/mcp/github the identity is not derivable from config
scope alone, so a batch rekey would either fabricate provenance or leave
exactly the rows that need it most; (b) permanent dual-format lookup —
rejected: doubles match logic forever and leaves two externalId dialects
in the catalog; (c) importer-emitted `legacyExternalId` field on
`DiscoveredAsset` — rejected: put migration trivia in the yield contract;
a generic `::` format lets the executor derive the legacy form.

## Decision 5 — `sourceDetails` for membership details

**Decision**: `DiscoveredAsset` gains `sourceDetails?: Record<string,
unknown> | null` and `DiscoveredAssetInstance` gains the same — written
to `source_component_memberships.details` /
`source_instance_memberships.details` respectively (columns shipped in
migration 022, currently written `null`). `asset.details` continues to
write canonical `components.details` unchanged.

**Rationale**: closes the tracked Wave A deferral
(`docker-importer-implementation-tracking.md` follow-up) with a minimal
contract addition — canonical facts stay last-writer on the shared row
for compatibility, per-source facts get a durable home per ADR-119 #4.
No existing importer is forced to populate `sourceDetails` on day one;
the contract makes it *possible* — and the wiring is what matters.

**Alternatives considered**: (a) moving all of `asset.details` to
memberships — rejected: would orphan `components.details` for
single-source components and break current reads; (b) heuristic field
splitting (canonical key list) — rejected: impossible to define
"canonical" generically across providers.

## Decision 6 — Backfill: defensible memberships, honest run history

**Decision**: migration 023 (`023_source_backfill.ts`) — for each live
`importer_configs` row of a migrated importer whose identity is
**derivable from scope alone** (azure `subscriptionId`; api-url/web-url
`url`; mcp-server `endpoint`; aws/kubernetes `sourceKey` if already
present — none will be, since the key is new; github skipped — `org.id`
needs an API call; alibaba skipped — `accountId` needs an API call):
create-or-match the `ImporterSource`, then create active memberships for
every component/instance last seen by that config's runs
(`components.lastSeenInRunId → import_runs.configId`). Historical
`import_runs.sourceId` stays `NULL` — those runs factually never
reported identity. Configs with underivable identity, deleted configs,
and `lastSeenInRunId NULL` components stay `LEGACY_UNATTRIBUTED`.

**Rationale**: the only hard requirement is *retirement continuity* — a
component that vanishes between the last pre-migration run and the first
post-migration run must still retire. That requires the component to
hold a membership under the Source the config maps to, which is
defensible precisely when the config's scope yields exactly one
identity. `sourceId` on old runs is deliberately not fabricated: those
runs never reported a source. Lazy adoption (Decision 4) covers every
component that *is* re-reported; backfill covers the never-reported
tail.

**Alternatives considered**: (a) backfill `import_runs.sourceId` by
config mapping — rejected: fabricates attribution history ADR-119
describes as "explicit absence, not a sentinel"; (b) no backfill —
rejected: stranding never-reported components in eternal `ACTIVE` breaks
retirement semantics; (c) backfill all configs including
identity-underivable ones via placeholder Sources — rejected: invents
Sources matched by nothing, violating "never matched by display name."

## Decision 7 — ADR fidelity: new ADR-120

**Decision**: ratify Wave B's contract surfaces in a new
`ADR-120-importer-source-migration.md`: the per-importer identity-key
table, `sourceKey` semantics, the `::` qualification format,
adopt-on-report, `sourceDetails`, and backfill defensibility rules.
Add `**Amended by ADR-120**` back-pointers to ADR-056 (asset/context
contract gains `sourceDetails`) and ADR-119 (its "decided per spec"
per-importer keys are now concretized); keep ADR-119's amends list in
`architecture-decisions.md` current.

**Rationale**: AGENTS.md's ADR-fidelity rule — enumerated contract
surfaces (config keys, asset fields, identity formats) may not live only
in spec artifacts.

## Decision 8 — No REST or agent-protocol changes

**Decision**: no new endpoints; `/importer-sources` (044) already exposes
the operator surface, and the agent executor already forwards
`source.identity` frames (protocol v3) — importers run the same
`reportSourceIdentity` call on the agent. `openapi.yaml` unchanged;
verified by the API contract test suite rather than regenerated docs.

**Watch item — test-mock trap**: backend integration tests that
`vi.mock` `getImporter` while resolving the **real** manifest will hit
`CONTRACT_VIOLATION` once manifests flag `reportsSourceIdentity`.
Affected suites (fakes must gain a `reportSourceIdentity` call):
`importers.test.ts`, `import-runs.test.ts`,
`import-reconciliation.test.ts`, `alibaba-import.test.ts`,
`edge-suggestion-generation.test.ts`, `config-drift.test.ts`,
`metadata-importer-safety.test.ts`, and remote-run/agent suites using
`importerName: "github"`/`"alibaba-cloud"` fixture names.
