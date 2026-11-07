# Contract: Source auto-grouping pass

Internal service contract + the API-visible deltas. The pass is backend-only;
importers and `DiscoveredAsset` are untouched (FR-016/017).

## Trigger contract

`runAutoGroupPass(context?)` — exported from
`packages/backend/src/services/source-group-service.ts`, modeled on
`runSuggestionPass` (`edge-suggestion-service.ts`):

- **Never throws.** All errors are logged (`appLogger.error`) and counted
  (`auto_group_pass_errors_total`); the host operation always proceeds.
- **Idempotent full recompute** over all enabled capable sources — safe to
  invoke on every trigger.
- **Ordered before suggestion generation** on run-completion paths so
  group coverage suppresses stale `DEPENDS_ON` candidates (ADR-113
  consequence, recorded in ADR-129).

### Call sites

| Trigger | Location | Ordering |
|---|---|---|
| Hub run success | `import-run-service.ts`, after reconciliation, *before* `updateRun(...COMPLETED)` so the group exists before COMPLETED is observable, and before `runSuggestionPass` | before COMPLETED + suggestions |
| Agent run success | `remote-run-service.ts` completion block, via new `RemoteRunStore.maintainAutoGroups(job)`, before `finalize(...COMPLETED)` and `stageSuggestions` | before COMPLETED + suggestions |
| `retireSource` | `importer-source-service.ts`, after commit | post-commit |
| `reactivateSource` | `importer-source-service.ts`, after commit | post-commit |

Non-triggers (deliberate): config delete → sources go `UNMONITORED` → groups
freeze (spec edge case); component lifecycle edits outside runs converge at
the next trigger (derived state).

## Membership contract

- A component joins source **S**'s auto-group iff **S is its sole
  effective-active reporter** — membership `active=true` AND source
  `status ∈ {ACTIVE, UNMONITORED}` (ADR-036 A1) — and its `componentGroupId`
  is `NULL` or already S's group (null-or-ours).
- Applies to **all** components regardless of category/provider/resourceType
  — no allowlist. Manual components (no memberships) are never assigned.
- Eviction is symmetric: losing exclusivity (second reporter appears,
  membership deactivated, source retiates) or human placement of an
  ineligible component inside the group → `componentGroupId → NULL`.

## Enablement contract

- Manifest capability: `ImporterManifest.autoGroups?: "source"` (core type);
  Docker declares it.
- Config opt-out: `scope.autoGroup === false` disables maintenance for the
  source bound to that config; absent/`true` = enabled. Evaluated against
  the **bound** config at trigger time.

## API deltas (`docs/openapi.yaml`)

| Route | Change |
|---|---|
| `PATCH /component-groups/{id}` | `409 GROUP_AUTO_MANAGED` when `lifecycle` is present on an auto-managed group; name/slug/description/teamOwnerId unaffected |
| `DELETE /component-groups/{id}` | `409 GROUP_AUTO_MANAGED` on auto-managed groups (checked before `REFERENCED`); human groups unchanged |

New core error code `GROUP_AUTO_MANAGED` (409, "Component group is managed by
an importer source") — regenerated into `docs/api.md` via `docs:api`.

## Config schema delta

`dockerConfigSchema` (strict) gains:

```ts
autoGroup: z.boolean().optional()
  .describe("Automatically maintain a ComponentGroup for this source's exclusively reported components (default true)")
```

Rendered into `docs/importers/docker.md`'s generated config table by
`docs:importers`; hand-written prose added alongside.
