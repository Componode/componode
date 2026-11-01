# Implementation Plan: Docker Workload Inventory

**Branch**: `046-docker-workload-inventory` | **Date**: 2026-11-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/046-docker-workload-inventory/spec.md`

## Summary

Ship `@componode/importer-docker` — a new in-tree importer package that
inventories Docker Engine workloads exclusively through assigned Import
Agents (spec 025–028 machinery, ADR-116/117/119). The importer declares
`targetRefKey` so the Agent preflights a plain `targetId` against the
versioned, read-only `${SECRETS_DIR}/docker-targets.json` registry and
hands the resolved, non-secret profile to the importer via
`context.resolveTarget()` (ADR-116 A5/A6). Four transports — local
socket/named pipe, mutual-TLS TCP, pinned-host-key SSH, and allowlisted
named Docker Context — are built on `dockerode`/`docker-modem` (SSH uses
the built-in `docker system dial-stdio` agent with ssh2 options we fully
control, including `hostVerifier` for SHA-256 pinning).

The importer reports the Docker Engine `/info.ID` via
`context.reportSourceIdentity()` before first yield, groups containers
into one `CONTAINER` Component per logical workload (canonical
`compose:{project}:{service}` key, `componode.component-id` label
override, daemon-scoped name fallback for standalone containers), and
emits one ComponentInstance per concrete container
(`{sourceIdentity}::{containerId}`). Persistence is allowlisted: image
ref/digest, ports, network/volume refs, redacted bind mounts — never env
vars, raw host paths, inspect JSON, or health output. Engine-state-only
status mapping; `dockerObservation`/health-aware rules stay Wave D;
Swarm stays Wave E.

Contract additions are ratified in new **ADR-121** in the same change:
the typed `docker-targets.json` profile schema, a `requiresAgent`
manifest flag enforced hub-side, a `resolvedTarget` parameter on
`testSecrets` so remote credential tests can probe through the resolved
profile, the Docker scope keys (`targetId`, environment mapping,
`includeImages`), and the identity/externalId formats.

## Technical Context

**Language/Version**: TypeScript 6 (strict), Node 24 runtime

**Primary Dependencies**: `dockerode@^5.0.1` (brings `docker-modem` +
`ssh2` transitively), `@componode/core` contracts (`DiscoveredAsset`,
`ImporterContext.reportSourceIdentity`/`resolveTarget`,
`parseTargetRegistry`), Zod, pnpm workspaces; importer depends only on
`core` + third-party client

**Storage**: PostgreSQL — no new tables; existing `importer_sources`,
`source_*_memberships`, `import_runs.sourceId`, `importer_configs.agentId`

**Testing**: vitest — importer unit tests through
`validateDiscoveredAsset` + mocked dockerode; agent-side registry/
preflight unit tests; backend integration tests (testcontainers Postgres)
for `requiresAgent` rejection and remote-run/dispatch paths

**Target Platform**: Import Agent process (Linux/Windows/macOS
containers or hosts); the importer also loads hub-side for manifest/
schema but never executes there (`requiresAgent`)

**Project Type**: pnpm monorepo — `packages/importer-docker` (new),
`packages/core` (contract additions), `packages/backend` (agent-binding
enforcement), `packages/agent` (credential-test target resolution);
`packages/frontend` untouched (schema-driven form + Execution selector
already exist)

**Performance Goals**: bounded container-inspect concurrency (default 8);
point-in-time snapshot — no event streaming

**Constraints**: no `sql.raw` (ADR-084); Zod at boundaries (ADR-095);
importer package depends only on `core` (ADR-065); lockstep registration
— `IMPORTER_PACKAGES`, backend + agent dependency manifests, agent image
importer set must all match (ADR-116 #7); fail-closed transports — no
plaintext, no skip-verify, no password-only SSH; secret material resolves
only via AGENT_MANAGED bundles or the Agent-local context store

**Scale/Scope**: 1 new importer package (~10 source files) + core
contract additions + backend validation + agent credential-test wiring +
ADR-121 + `docs/importers/docker.md` + OpenAPI sync (none expected —
no new endpoints)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Verdict | Notes |
|---|---|---|
| I. Single-Organization | PASS | Target profiles are deployer-provisioned agent config, not tenancy |
| II. Importer-First | PASS | Pull-only `AsyncGenerator<DiscoveredAsset>`; importer never touches DB; depends only on `core` + dockerode |
| III. Two-Level Taxonomy | PASS | `CONTAINER`/`PACKAGE_REGISTRY` categories and `DOCKER` provider all already exist — no taxonomy change; clarified image→`PACKAGE_REGISTRY` mapping preserves the category split |
| IV. Environment-as-Instance | PASS | One Component per workload, Instances per concrete container; env comes from configured label mapping, `OTHER` default — no env field on Component |
| V. Factual vs. Meaning | PASS | Importer emits no edges; Compose project/service are metadata only; products stay human-curated |
| VI. Test-First | PASS | tasks.md orders failing tests before each slice; `validateDiscoveredAsset` exercised per emitted shape |
| VII. Observability | PASS | Run phases via `context.reportPhase`, structured `context.logger`; no `console.*`, no secret values in logs |

**Gate result: PASS — no violations, no complexity justifications needed.**

Post-design re-check: PASS — the `requiresAgent` flag is manifest
metadata, `testSecrets`' target parameter is a contract refinement of an
existing surface, and the context-store resolver still lives inside the
importer package (Agent filesystem reads are part of its job — same as
secretRef `file` resolution).

## Project Structure

### Documentation (this feature)

```text
specs/046-docker-workload-inventory/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions + alternatives
├── data-model.md        # Phase 1 — scope, profile, and asset mapping
├── contracts/           # Phase 1 — ratified contract text (feeds ADR-121)
│   ├── docker-target-profiles.md
│   ├── importer-contract-changes.md
│   └── identity-and-mapping.md
├── quickstart.md        # Phase 1 — validation scenarios
├── checklists/requirements.md
└── tasks.md             # Phase 2 — /speckit-tasks output
```

### Source Code (repository root)

```text
packages/
├── importer-docker/                      # NEW — core-only deps + dockerode
│   ├── src/
│   │   ├── config.ts                     # Zod scope schema (targetId, envLabel, envMap, includeImages)
│   │   ├── manifest.ts                   # name, secrets, reportsSourceIdentity, targetRefKey, requiresAgent
│   │   ├── importer.ts                   # DockerImporter — run + testSecrets
│   │   ├── target-profile.ts             # typed zod schema + validation of resolved profile
│   │   ├── transport.ts                  # profile → dockerode options (socket/tcp/ssh/context)
│   │   ├── context-store.ts              # named Docker Context resolution on the Agent
│   │   ├── identity.ts                   # workload/instance externalId construction
│   │   ├── mapping.ts                    # container/inspect → DiscoveredAsset + allowlisted fields
│   │   └── index.ts
│   └── package.json                      # deps: @componode/core, dockerode
├── core/src/
│   ├── contracts/importer.ts             # + resolvedTarget on testSecrets signature
│   ├── importer-registry.ts              # + requiresAgent on ImporterManifest
│   └── index.ts                          # export additions
├── backend/src/
│   ├── services/importer-config-service.ts  # reject agentId-less configs when manifest.requiresAgent
│   └── services/import-run-service.ts       # defense-in-depth: refuse in-process run for requiresAgent
├── agent/src/
│   └── client.ts                         # credential.test: targetRefKey → loadTargetProfile → testSecrets 3rd arg
├── docs/importers/docker.md              # NEW user guide (+ index.md + docs-site sidebar)
├── researches/adrs/ADR-121-*.md          # NEW — Docker importer contract ratification
├── researches/architecture-decisions.md  # index + amends lists
├── researches/docker-importer-implementation-tracking.md  # Phase 3 checkboxes
└── docs/roadmap.md                       # Shipped + Next
```

**Structure Decision**: existing pnpm-workspace layout. The new importer
package follows the `importer-*` convention (config/manifest/importer +
helpers). `packages/core` gains two small contract refinements;
`packages/backend` gains manifest-driven agent enforcement;
`packages/agent` gains profile resolution on the credential-test path.
No frontend code, no migrations, no REST endpoints.

## Phase 0 → research.md

Resolved decisions (full rationale + alternatives in `research.md`):

1. **Client** — `dockerode@^5.0.1` (2026-06-24, >7 days old, Apache-2.0,
   0 vulns). All four transports map onto it; SSH uses docker-modem's
   built-in `docker system dial-stdio` agent with explicit
   `sshOptions` (`privateKey`, `passphrase`, `hostVerifier` — SHA-256
   pin enforced there). `checkServerIdentity`/TLS opts for mTLS TCP.
2. **Docker Context transport** — importer-local resolver reads the
   Agent's Docker context store (`$DOCKER_CONFIG/contexts/meta/` or
   `~/.docker/contexts/meta/`) for the allowlisted context name; rejects
   `default`/`SkipTLSVerify`; resolves TLS material paths into dockerode
   options. Context ssh:// endpoints are not supported in Wave C —
   direct SSH profiles cover that case.
3. **`requiresAgent` enforcement** — new optional `ImporterManifest`
   flag; `importer-config-service` rejects create/update without
   `agentId`, and the run service refuses in-process dispatch for such
   importers (defense in depth). Manifest flag rather than a name
   hardcode — generic contract, frontend can hint later.
4. **`testSecrets` target resolution** — signature gains optional third
   param `resolvedTarget?: unknown`; `handleCredentialTest` performs the
   same `targetRefKey` → `loadTargetProfile` preflight as the job path
   and passes the profile through. Minimal, backward compatible.
5. **Profile schema** — typed Zod per transport
   (`socket`/`tcp`/`ssh`/`context`), validated importer-side before any
   network access; the agent's generic envelope check stays as-is. The
   registry entry remains the allowlist; the importer enforces the
   transport contract. Ratified in ADR-121.
6. **Scope shape** — `{ targetId, environmentLabel?, environmentMap?,
   includeImages? }`; env label read from container labels then Compose
   service labels; unmapped → `OTHER`.
7. **Identity mapping** — Source: `docker-engine:{infoID}` (fallback
   scope `sourceKey`); Component: `compose:{project}:{service}` |
   `workload:{overrideId}` | `{sourceId}::{containerName}` fallback;
   Instance: `{sourceId}::{containerId}`; Image (opt-in):
   `docker-image:{repo}@{digest}` shared canonical component.
8. **Status mapping (Wave C)** — engine `State.Status` only:
   `running`→`RUNNING`, `created`/`paused`/`exited`→`STOPPED`,
   `dead`/`restarting`/`removing`→`ERROR`, anything unrecognized→
   `ERROR` (fail closed, matches ADR-112 surface). Health ignored.
9. **ADR fidelity** — new ADR-121 ratifies: profile schema, scope keys,
   `requiresAgent`, `testSecrets` param, identity/externalId formats,
   status rules, minimization allowlist; back-pointers on
   ADR-056/065/116/117 where they present the touched surface as closed.
10. **No REST/protocol/migration changes** — `credential.test` payload
    already carries `scope`; `job.assign` unchanged; `openapi.yaml`
    untouched unless review finds drift.

## Phase 1 → data-model.md, contracts/, quickstart.md

- `data-model.md` — scope/profile entities, Component/Instance mapping
  tables, env mapping, membership/details split.
- `contracts/docker-target-profiles.md` — registry profile JSON schema
  per transport (the ADR-121 contract text).
- `contracts/importer-contract-changes.md` — `requiresAgent`,
  `testSecrets` signature, manifest additions.
- `contracts/identity-and-mapping.md` — source/component/instance/image
  externalId formats + status + minimization allowlist.
- `quickstart.md` — runnable scenarios proving US1–US6.
