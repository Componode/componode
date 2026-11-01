# Quickstart: validating Swarm inventory (spec 048)

## Unit (importer package)

```bash
cd packages/importer-docker && pnpm test
```

Expect: swarm-mapping tests cover every status-table row (replicated
full/partial/zero, global, drain/down/unreachable nodes); importer tests
cover the gate (inactive Swarm / worker-only → zero swarm calls),
version floor (<1.41 → run fails), and `swarmObservation` allowlist.

## Integration (backend)

```bash
cd packages/backend && pnpm vitest run test/integration/docker-import.test.ts
```

Expect: Swarm assets persist (`CONTAINER_ORCHESTRATION`/`COMPUTE`/
`SECRET` components), replica-`ERROR` instance degrades a wired
product's rollup (ADR-112), source-scoped `GONE` on absent service.

## Manual (against a real manager — optional)

```bash
docker swarm init
docker service create --name demo --replicas 3 nginx:alpine
# agent-bound config → trigger run → /sources detail shows the engine
# catalog: demo → CONTAINER_ORCHESTRATION, instance RUNNING (3/3)
docker service scale demo=1   # next run → ERROR (1/3)
docker service scale demo=0   # next run → STOPPED
docker service rm demo        # next run → GONE
```

## Contract audit

Inspect any stored instance `rawConfig.swarmObservation` /
`swarmNodeObservation` — only the `contracts/swarm-inventory.md`
allowlist keys appear; no task lists, logs, or secret/config contents.
