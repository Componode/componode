# Contract: enriched container + Swarm instance `rawConfig` fields

Ratified design: `researches/docker-importer-enrichment-pack.md` (spec
064). Recorded as ADR-121 **Amendment 3** by this change. All keys are
additive and optional — absent when the engine does not report them.

## Container instances (`CONTAINER` assets)

```jsonc
"rawConfig": {
  // …existing keys unchanged…
  "imageId": "sha256:…",            // container inspect .Image
  "hostConfig": {                   // HostConfig — omitted when empty
    "memoryBytes": 0,               // .Memory (bytes)
    "nanoCpus": 0,                  // .NanoCpus
    "pidsLimit": 0,                 // .PidsLimit
    "restartPolicy": {              // .RestartPolicy
      "mode": "unless-stopped",     // .Name verbatim
      "maxRetries": 5               // .MaximumRetryCount — only when > 0
    },
    "privileged": true,             // .Privileged — only when true
    "readOnlyRootfs": true,         // .ReadonlyRootfs — only when true
    "logDriver": "json-file"        // .LogConfig.Type
  },
  "healthcheck": {                  // Config.Healthcheck — omitted when absent
    "intervalSeconds": 30,          // .Interval ns → s
    "timeoutSeconds": 10,           // .Timeout ns → s
    "retries": 3,                   // .Retries
    "startPeriodSeconds": 0         // .StartPeriod ns → s
  }
}
```

**Exclusions (restated)**: `Config.Healthcheck.Test` (command),
`Config.Env`, `HostConfig.Binds`/`Mounts` raw paths, `State.Health.Log`,
`/stats`, events, logs. `dockerObservation` is not extended — it stays
pure state/health status.

## Swarm service instances (`CONTAINER_ORCHESTRATION` / `swarm-service`)

```jsonc
"rawConfig": {
  "swarmObservation": {
    "mode": "replicated-job",       // replicated | global | replicated-job | global-job
    "desired": 1, "running": 1, "completed": 0, "updateState": "…", "observedAt": "…"
  },
  "ports": [                        // Spec.EndpointSpec.Ports — omitted when empty
    { "protocol": "tcp", "target": 80, "published": 8080, "publishMode": "ingress" }
  ],
  "networks": ["frontend"]          // Spec.Networks[].Target — omitted when empty
}
```

`details.mode` carries the same mode value. Job services remain
`CONTAINER_ORCHESTRATION` — no `JOB` components.
