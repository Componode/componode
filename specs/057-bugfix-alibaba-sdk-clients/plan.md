# Implementation Plan: Alibaba Cloud importer SDK client fixes

**Branch**: `057-bugfix-alibaba-sdk-clients` | **Date**: 2026-11-02 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/057-bugfix-alibaba-sdk-clients/spec.md`

## Summary

Fix the two upstream bugs in `packages/importer-alibaba-cloud` reported by
the Playwright workload (GitHub issues #231, #232):

1. **CJS interop crash (#232)**: the three Alibaba SDK client classes are
   consumed as default imports; under bundled CJS runtimes the import binds
   the module *namespace* (`{ default: Client, __esModule: true, ... }`)
   instead of the constructor, so `new Client()` throws
   `is not a constructor`. Fix: switch to namespace imports and resolve the
   constructor through a `.default ??` fallback helper — correct in both
   plain Node ESM (which unwraps `__esModule` defaults) and bundled CJS.
2. **No region pinning / no STS/BSS redirect (#231)**: `buildSdkConfig`
   never sets `regionId`, and only Resource Center honors `endpoint`.
   Fix: new `region` config field feeds `Config.regionId` on all three
   clients; new `stsEndpoint` / `bssEndpoint` fields redirect STS and BSS
   (an explicit endpoint wins over `region` for that client);
   `endpoint` stays Resource Center-only.

Both fixes land in the importer package only — no backend/agent/API/schema
changes. The importer guide regenerates from the config schema
(`docs:importers`) and gets a prose note on region/endpoint semantics.

## Technical Context

**Language/Version**: TypeScript (Node ESM; importer builds with `tsc`)

**Primary Dependencies**: `@alicloud/resourcecenter20221201`,
`@alicloud/sts20150401`, `@alicloud/bssopenapi20171214` (CJS packages with
`__esModule` + `exports.default`), `@alicloud/openapi-core`
(`$OpenApiUtil.Config` supports `regionId`), `@componode/core`, zod

**Storage**: N/A — importer package, no persistence

**Testing**: Vitest unit tests (`packages/importer-alibaba-cloud/test/`)

**Target Platform**: Node 22+/24 — plain `tsc` ESM output consumed by hub
(`packages/backend`) and Import Agent (`packages/agent`), plus bundled CJS
runtimes downstream

**Project Type**: pnpm workspace monorepo — single importer package change

**Performance Goals**: N/A — constructor/config-surface fix

**Constraints**: importer contract — pull-only `AsyncGenerator`, no DB, no
backend/other-importer imports; `urlSafetyError` governs URL config fields
(SSRF); `.describe()` strings are user-facing (schema-driven forms +
generated docs); test-first per constitution VI

**Scale/Scope**: 2 modified source files (`client.ts`, `config.ts`), 1
modified/extended test file, 1 regenerated + hand-edited doc page

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Verdict | Notes |
|---|---|---|
| I. Single-Organization | PASS | no tenancy surface |
| II. Importer-First | PASS | stays pull-only generator; no DB, no backend import, only `@componode/core` added (already a dep) |
| III. Two-Level Taxonomy | PASS | no entity/taxonomy change |
| IV. Environment-as-Instance | PASS | no lifecycle/status change |
| V. Factual vs. Meaning | PASS | no rollup/derivation change |
| VI. Test-First | PASS | failing tests for interop helper + regionId/endpoint wiring precede implementation in tasks.md |
| VII. Observability | PASS | no new signals needed — constructor crash already surfaces as a run error; field descriptions/docs carry the contract |

No violations — Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/057-bugfix-alibaba-sdk-clients/
├── plan.md              # This file
├── research.md          # Phase 0 output — interop + regionId findings
├── data-model.md        # Phase 1 output — config schema deltas
├── quickstart.md        # Phase 1 output — validation guide
├── contracts/
│   └── config.md        # Phase 1 output — AlibabaCloudConfig field contract
├── checklists/
│   └── requirements.md  # spec-quality checklist (specify output)
└── tasks.md             # /speckit-tasks output
```

### Source Code (repository root)

```text
packages/importer-alibaba-cloud/
├── src/
│   ├── client.ts        # namespace imports + sdkCtor() fallback;
│   │                    # buildSdkConfig gains {endpoint, regionId};
│   │                    # buildClients wires per-client endpoint + regionId
│   └── config.ts        # schema += region, stsEndpoint, bssEndpoint
└── test/
    └── client.test.ts   # NEW — sdkCtor cases + buildSdkConfig wiring

docs/importers/alibaba-cloud.md   # regenerated contract table + prose note
```

**Structure Decision**: in-place fix inside the existing importer package —
no new modules beyond a test file; the `endpoint` field's semantics are
preserved (Resource Center only) while STS/BSS gain dedicated fields.

## Phase 0 — Research summary

See [research.md](research.md). Key decisions: namespace imports +
`sdkCtor()` `.default ??` fallback (verified SDK CJS shape: `__esModule` +
`exports.default = Client`); `region` field → `Config.regionId` on all
three clients (verified `regionId` is a supported Config field consumed
into `_regionId`); `stsEndpoint`/`bssEndpoint` reuse the `urlSafetyError`
validation, which permits mock hostnames while blocking private IPs; an
explicit per-service endpoint takes precedence over `region`.

## Phase 1 — Design summary

- [data-model.md](data-model.md): `AlibabaCloudConfig` +3 optional fields
  (`region`, `stsEndpoint`, `bssEndpoint`); field semantics and precedence.
- [contracts/config.md](contracts/config.md): the public config contract —
  new fields, validation rules, and client-wiring mapping.
- [quickstart.md](quickstart.md): test-first validation path (unit tests +
  `pnpm build` smoke of client construction).

## Constitution Check — post-design re-evaluation

Unchanged: PASS across all seven principles. The design stays inside the
importer package, adds no dependencies, and keeps the pull-only contract;
tests lead implementation; the SSRF posture on URL fields is preserved.

## Risk notes

- **`sdkCtor` must cover both runtime shapes**: namespace-shaped and
  already-unwrapped constructor — the `.default ??` fallback covers both;
  a unit test pins both cases so a future refactor can't regress it.
- **`regionId` on clients where regional endpoints don't exist**: BSS and
  Resource Center are effectively global services — `regionId` feeds
  endpoint-rule resolution but an explicit `endpoint`/`stsEndpoint`/
  `bssEndpoint` always wins. If a future Alibaba region split causes
  resolution issues, the per-service override is the escape hatch.
- **`.describe()` text is a public surface**: it drives schema-generated
  importer forms and the regenerated docs table — wording must distinguish
  `regionIds` (discovery filter) from `region` (connectivity pinning).
