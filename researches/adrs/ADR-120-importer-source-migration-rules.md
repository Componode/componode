### ADR-120 — Importer source migration rules (Wave B)

> **Status:** Ratified

**Context**: [ADR-119](./ADR-119-importer-source-identity-and-lifecycle.md)
ratified the `ImporterSource` model but deliberately deferred each importer's
concrete identity key, the `externalId` treatment for collision-prone legacy
IDs, and how pre-source rows gain Source membership. Spec 045 migrates all 8
in-tree importers; this ADR ratifies the rules that migration actually ran
under — preserving the "no auto-split / auto-merge / auto-rekey" invariant
while making every adopting importer source-aware.

**Decision**:

1. **Per-importer identity keys are canonical and non-secret.**

   | Importer | `externalIdentity` | Scope-less fallback |
   |---|---|---|
   | github | `{canonicalApiBaseUrl}#org:{orgId}` | `#login:{org}` when org read is forbidden |
   | alibaba-cloud | STS `GetCallerIdentity` `accountId` | none — run fails |
   | azure | `subscriptionId` | `scope.sourceKey` |
   | aws | `scope.sourceKey` (required) | none — run fails |
   | kubernetes | canonical `endpoint` URL | `scope.sourceKey` |
   | mcp-server | canonical `endpoint` URL | `scope.sourceKey` |
   | api-url / web-url | canonical `url` | none — URL required |

   GitHub's composite key is required because numeric org IDs collide across
   separate GHES installations; the github.com default base URL keeps its
   identity stable. `sourceKey` is an admin-supplied stable, non-secret key
   used only where the provider offers no trustworthy identity — exactly the
   escape hatch ADR-119 already allowed.

2. **`externalId` qualification is `{identity}::{localId}`** via
   `qualifyExternalId` in `@componode/core`, applied only where the existing
   ID is source-local or collision-prone (aws, azure, kubernetes,
   mcp-server, and GHES github). Globally unique IDs (github.com numeric
   IDs, Alibaba ARNs, URL identities) are **not** qualified — churn buys
   nothing there.

3. **Adopt-on-report is the only rekey path.** When a source-aware run
   reports an ID that doesn't match the qualified form, the backend tries
   exactly one legacy `(category, provider, rawLocalId)` match within the
   importer's own provider space, relinks the membership, and rewrites that
   component's `externalId` once. There is no batch `externalId` rewrite in
   migrations — a row the live run never sees is never rekeyed.

4. **`sourceDetails` on `DiscoveredAsset`/`DiscoveredAssetInstance`** carry
   per-source facts into `source_component_memberships.details` /
   `source_instance_memberships.details`; `details` stays shared canonical
   state. This resolves the last-writer-wins hazard the membership columns
   were created for (ADR-119 item 4 noted they land unused until a later
   wave populated them — this wave).

5. **Backfill (migration 023) is derivable-only.** A Source + memberships are
   created only where the identity is computable from the live config's
   scope (azure `subscriptionId`, kubernetes/mcp-server `endpoint`,
   api-url/web-url `url`); everything else — github, alibaba-cloud, aws,
   scope-less configs — adopts on its next run. `import_runs.sourceId` is
   **never** backfilled (historical runs never reported identity; `NULL` =
   `LEGACY_UNATTRIBUTED` is factually correct), no lifecycle changes, no
   split/merge. The migration is idempotent (`ON CONFLICT DO NOTHING`).

**Consequences**: Source membership `details` is now live data — schema shape
from migration 022 is unchanged. Adopting importers that previously ran with
empty optional scope fields now fail fast (`sourceKey`/`endpoint`/
`subscriptionId` required) — intentional fail-closed, documented in each
importer's guide.

**Amendments to earlier ADRs**: [ADR-056](./ADR-056-importer-interface-signature.md)
(`sourceDetails` fields extend the `DiscoveredAsset` contract),
[ADR-119](./ADR-119-importer-source-identity-and-lifecycle.md) (item 4's
"membership details unused until a later wave" deferral resolves here;
concrete per-importer keys ratified).
