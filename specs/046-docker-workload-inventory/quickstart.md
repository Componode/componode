# Quickstart: Docker Workload Inventory — validation scenarios

**Feature**: `046-docker-workload-inventory` | **Spec**: [spec.md](./spec.md)

Runnable scenarios proving US1–US6. Each maps to automated tests in
`tasks.md`; the manual path uses a real agent where noted.

## Prerequisites

- Repo built (`pnpm build`); agent package built (`packages/agent`).
- For manual runs: an Import Agent enrolled per `docs/agents.md` with a
  writable `SECRETS_DIR` for `docker-targets.json`; a reachable Docker
  daemon (any transport).
- Backend running with a logged-in admin session.

## S1 — End-to-end import via agent (US1)

1. Provision the agent: `docker-targets.json` =
   `{"version":1,"targets":{"local":{"transport":"socket","path":"/var/run/docker.sock"}}}`.
2. Create a Docker importer config bound to that agent with scope
   `{"targetId":"local"}` (Importers → New config → Execution: agent).
3. Trigger a run → run completes `SUCCEEDED`.
4. Catalog shows one `CONTAINER`/`DOCKER` Component per workload;
   Instances carry image ref/digest, ports, mounts (redacted), networks.
5. `GET /importer-sources` shows `docker-engine:{id}` bound to the
   config; `import_runs.sourceId` attributed.

**Negative**: scope `{"targetId":"nope"}` → run fails
`TARGET_RESOLUTION_FAILED` before any network attempt; agent stays
connected and ready.

## S2 — Identity stability (US2)

1. Run a compose stack (`commerce` project, `web`/`api` services) on
   daemon A (DEV) and daemon B (PROD) via two targets/configs.
2. → one shared Component per service; two Instances each, one per
   Source membership.
3. Rebuild `web` on A → new Instance under the same Component; the old
   A Instance goes `GONE`; B's untouched; a human-wired
   `DEPENDS_ON_COMPONENT` edge survives.
4. Relabel service with `componode.component-id: commerce-api`, rename
   project → same Component (externalId `workload:commerce-api`).
5. Rename without the label → distinct Component; no edge transfers.

## S3 — Transport matrix (US3)

| Profile | Expect |
|---|---|
| `socket` (mounted docker.sock) | imports |
| `tcp` with `clientCert`/`clientKey` (+ `caCert` for private CA) | imports; server verified |
| `tcp` missing client cert → | rejected before connect |
| `tcp` with a hypothetical skip-verify → | rejected (field doesn't exist — unknown key) |
| `ssh` with `hostKeySha256` + `privateKey` | imports via `docker system dial-stdio` |
| `ssh` wrong pin → | connection fails closed |
| `ssh` without pin / password-only → | profile invalid |
| `context` named context → | resolves agent-local store, imports |
| `context` `default` or `SkipTLSVerify` → | rejected |

Credential test for each bound config → minimal probe (`ping`/`version`),
actionable non-secret errors; never enumerates containers.

## S4 — Source lifecycle (US4)

1. Empty daemon → Source still registers; run succeeds with 0 assets.
2. Delete the config → Source `UNMONITORED`; run history + memberships
   intact.
3. New profile `local2` on the same engine + new config → reattaches to
   the same `ImporterSource`; no duplicate Components.
4. Kill the daemon mid-enumeration → run `FAILED`; prior Components and
   Instances untouched (no retirement).

## S5 — Minimization (US5)

1. Container with env `SECRET_KEY=...`, bind mount `/home/user/data`,
   and a healthcheck → imported.
2. Assert: no env values, no `/home/user/data` string, no health output
   anywhere in API responses; bind mount shows `type=bind` +
   destination + opaque ref only.
3. `includeImages` off → no image Components; on → `PACKAGE_REGISTRY`
   Components with `instances: []`.

## S6 — Guide (US6)

1. `docs/importers/docker.md` exists, linked from
   `docs/importers/index.md` and the VitePress sidebar.
2. Fresh-agent walkthrough of each transport matches reality; every
   scope field, secret key, and failure mode documented.

## Automated coverage map

| Scenario | Test home |
|---|---|
| S1, S4 | backend integration (dispatch/preflight/attribution) + agent unit (registry load, executor resolveTarget) |
| S2 | importer unit (identity construction) + backend integration (membership reconciliation) |
| S3 | importer unit (profile schema + transport builder, mocked dockerode) + agent unit (credential.test target resolution) |
| S5 | importer unit (mapping allowlist, redaction) |
| S6 | docs review + docs build |
