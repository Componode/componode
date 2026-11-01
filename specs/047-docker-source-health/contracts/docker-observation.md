# Contract: `dockerObservation` + health-aware status mapping

Ratified in ADR-121 **Amendment 1** (this change) — replaces item 7's
engine-state-only rule and item 8's allowlist accordingly.

## `rawConfig.dockerObservation` allowlist

Emitted per concrete container Instance by `@componode/importer-docker`:

```jsonc
{
  "dockerObservation": {
    "state": "running",               // State.Status verbatim ("unknown" fallback)
    "exitCode": 137,                  // optional — only when non-zero
    "oomKilled": true,                // optional — only when true
    "restarting": true,               // optional — only when true
    "startedAt": "2026-11-01T10:00:00.000Z",   // null on docker zero-time
    "finishedAt": null,
    "health": {                       // null when no healthcheck configured
      "status": "unhealthy",          // healthy | unhealthy | starting
      "failingStreak": 3              // optional — only when > 0
    }
  }
}
```

**Exclusions** (unchanged from ADR-121 item 8, restated for the new
payload): `State.Health.Log` (check output), `Config.Healthcheck.Test`
(test command), `/stats`, events, full inspect JSON, history series.
The importer MUST NOT read `Health.Log` at all.

## State × health → `InstanceStatus` table

| `State.Status` | `State.OOMKilled` | `State.Health.Status` | `InstanceStatus` |
|---|---|---|---|
| `running` | `false`/`undefined` | `healthy` / `starting` / absent | `RUNNING` |
| `running` | `false`/`undefined` | `unhealthy` | `ERROR` |
| `running` | `true` | any | `ERROR` |
| `created` / `paused` / `exited` | `false`/`undefined` | any | `STOPPED` |
| `created` / `paused` / `exited` | `true` | any | `ERROR` |
| `dead` / `restarting` / `removing` / other / `undefined` | any | any | `ERROR` |
| not yielded in a completed run | — | — | `GONE` (source-scoped reconciliation, unchanged) |

Notes: `starting` health is inconclusive — not failure. `OOMKilled`
overrides the `STOPPED` mapping for `exited` (Docker reports OOM as a
clean exit otherwise). Non-zero `exitCode` alone does not escalate
`exited` past `STOPPED` (Wave C semantics preserved).

## `ContainerInspect` additions (importer-internal)

`State` gains: `OOMKilled?: boolean`, `Restarting?: boolean`,
`FinishedAt?: string`, `Health?: { Status?: string; FailingStreak?: number }`.
No `Health.Log` field is declared — it must not be read.
