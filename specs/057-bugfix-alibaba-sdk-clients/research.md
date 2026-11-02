# Research: Alibaba Cloud importer SDK client fixes

**Feature**: `057-bugfix-alibaba-sdk-clients` | **Date**: 2026-11-02

All findings verified against the vendored packages under
`packages/importer-alibaba-cloud/node_modules/` and the Playwright
workload under `playwright/`.

## D1 — How to resolve the SDK client constructor under bundled CJS

**Decision**: Replace the three default imports with `import * as $X`
namespace imports and resolve each constructor through a small
`sdkCtor()` helper: `mod.default ?? mod`.

**Evidence** (verified in `node_modules`):

- `@alicloud/sts20150401@1.2.0`, `@alicloud/resourcecenter20221201@1.6.0`,
  `@alicloud/bssopenapi20171214` all ship **CJS-only** `dist/client.js`
  (`"main": "dist/client.js"`, no `exports` map, no `type: module`).
- Each file ends with `exports.default = Client` and sets
  `Object.defineProperty(exports, "__esModule", { value: true })`
  (client.js:41 / :336 etc.).
- Node's ESM loader detects `__esModule` via cjs-module-lexer and binds a
  default import to `module.exports.default` → works under plain `tsc` ESM
  output (what backend/agent ship today).
- Bundled CJS consumers can instead bind the whole `module.exports`
  namespace → `new X()` on `{ default: Client, ... }` throws
  `TypeError: ... is not a constructor` — the reported failure.
- `.default ?? mod` resolves correctly in both shapes: if the module
  object has a `default` property it is the constructor; if a bundler
  already collapsed the import to the class, `mod.default` is undefined
  and `mod` is used directly.

**Alternatives considered**:

- *Bump SDK versions* — no upstream fix known; dependency churn without a
  verified resolution (and majors ship in their own PR per policy).
- **`createRequire` + `require()`** — works but discards static types and
  adds plumbing for no benefit over the fallback.
- *Bundler config (`esbuild`/`__toESM`)* — no bundler exists in this repo;
  the consuming bundle is downstream (workload/runtime packaging), so the
  fix must live in the importer source per the issue.

## D2 — How to pin SDK clients to a region

**Decision**: Add `region?: string` to the config schema; pass it as
`regionId` on `$OpenApiUtil.Config` for all three clients. `regionIds`
remains exclusively the Resource Center `SearchResources` filter.

**Evidence** (verified):

- `$OpenApiUtil.Config` declares `regionId?: string`
  (`openapi-core/dist/utils.d.ts:77` — field on the Config model).
- The SDK base client stores it: `this._regionId = config.regionId`
  (`openapi-core/dist/client.js:114`) and feeds endpoint-rule resolution
  (`getEndpointRules(product, regionId, ...)`, utils.d.ts:424) plus the
  request context (`regionId: this._regionId`, client.js:1216).
- So `new $OpenApiUtil.Config({ ..., regionId })` is the supported lever
  the issue asked for — no SDK internals bypassed.

**Alternatives considered**:

- *Derive `regionId` from `regionIds[0]`* — rejected at clarify: silently
  couples the discovery filter to connectivity; adding a filter region
  would reroute STS/BSS traffic. `region` keeps the two semantics
  independent (per spec Clarifications).

## D3 — How to redirect STS and BSS calls

**Decision**: Add `stsEndpoint` and `bssEndpoint` optional URL fields,
validated with the same `urlSafetyError` refinement as `endpoint`, and
pass each to its client's Config. Explicit endpoint beats `region` for
that client (the SDK short-circuits endpoint rules when `config.endpoint`
is set — `client.d.ts:181`).

**Evidence** (verified):

- `urlSafetyError` (`packages/core/src/validation/url-safety.ts`) rejects
  literal private IPs, loopback, link-local/metadata, `localhost`, and
  `.local` — but permits named hosts. The workload mock runs at
  `https://mock-alibaba:9443` (compose service name), so the same
  validation admits test mocks without opening SSRF to raw IPs.
- The Playwright mock serves STS, Resource Center, and BSS actions from
  one HTTPS server (`playwright/mocks/alibaba/server.ts`) — per-service
  endpoint fields let the workload point all three at it; today only RC
  could be redirected.
- The workload currently seeds `scope: {}` with no endpoint at all
  (`playwright/data/seed-app-flows.ts:88-92`) — widening scope is a
  workload-branch concern; this feature only makes the fields exist.

**Alternatives considered**:

- *Widen `endpoint` to all three clients* — rejected: Alibaba endpoints
  are per-product; one URL can't correctly serve three production
  services, and it would break `endpoint`'s documented RC-only scope.
- *Separate `mockEndpoint` test-only field* — rejected: a test-only config
  field is a smell; the general per-service override serves both prod
  (VPC gateways) and test use.

## D4 — Test seams

**Decision**: Export `buildSdkConfig` (pure factory — today module-private)
so unit tests assert `.regionId`/`.endpoint` on the returned `Config`;
add a `sdkCtor` unit test covering both module shapes; keep the existing
`vi.mock("../src/client.js")` importer tests untouched.

- The `Config` model instance exposes its fields directly
  (`config.regionId`, `config.endpoint`) — no SDK internals needed.
- `buildClients` itself constructs real SDK clients safely (no network in
  the constructor), so a smoke test can assert construction succeeds.
- The bundled-CJS failure is a packaging-layer shape; the unit test pins
  `sdkCtor`'s contract (namespace → `.default`, class → itself) rather
  than simulating a bundler. The workload E2E is the real proof.

## Open questions — none

All spec decisions resolved at clarify (region field + per-service
endpoints); no remaining NEEDS CLARIFICATION.
