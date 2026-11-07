# Data Model: Docker importer enrichment (spec 064)

No schema changes. All additions are fields inside existing JSONB
passthroughs: `component_instances.rawConfig`, `components.details`, and
image-asset `details`. Every field is optional/absent-when-unreported.

## Container ComponentInstance `rawConfig` (additive)

```jsonc
{
  // ...existing keys unchanged (containerName, imageRef, imageDigest,
  // state, exitCode?, ports, networks, mounts, dockerObservation)...
  "imageId": "sha256:9f8e…",                    // inspect.Image — joins image asset details.imageId
  "hostConfig": {                              // omitted when nothing reported
    "memoryBytes": 536870912,                  // HostConfig.Memory
    "nanoCpus": 1500000000,                    // HostConfig.NanoCpus
    "pidsLimit": 512,                          // HostConfig.PidsLimit
    "restartPolicy": {                         // HostConfig.RestartPolicy
      "mode": "unless-stopped",                // Name verbatim
      "maxRetries": 5                          // MaximumRetryCount, only when > 0
    },
    "privileged": true,                        // only when true
    "readOnlyRootfs": true,                    // HostConfig.ReadonlyRootfs, only when true
    "logDriver": "json-file"                   // HostConfig.LogConfig.Type
  },
  "healthcheck": {                             // Config.Healthcheck — omitted when absent
    "intervalSeconds": 30,                     // Interval ns → s
    "timeoutSeconds": 10,                      // Timeout ns → s
    "retries": 3,                              // Retries
    "startPeriodSeconds": 0                    // StartPeriod ns → s
  }
}
```

Rules: `Config.Healthcheck.Test` is never declared/read; `dockerObservation`
keeps state/health-status only; booleans emit only when `true`.

## Swarm service ComponentInstance `rawConfig` (additive)

```jsonc
{
  "swarmObservation": {
    "mode": "replicated-job",   // replicated | global | replicated-job | global-job
    "desired": 1, "running": 1, "completed": 0, "updateState": "completed", "observedAt": "…"
  },
  "ports": [                                // Spec.EndpointSpec.Ports — omitted when empty
    { "protocol": "tcp", "target": 80, "published": 8080, "publishMode": "ingress" }
    // published/publishMode optional; protocol defaults "tcp" when absent
  ],
  "networks": ["frontend", "backend"]       // Spec.Networks[].Target
}
```

Component `details.mode` mirrors `swarmObservation.mode` (job modes
included). Job services stay `CONTAINER_ORCHESTRATION`.

## Engine Component (new, always emitted)

```jsonc
{
  "category": "COMPUTE",
  "provider": "DOCKER",
  "resourceType": "docker-engine",
  "name": "<info.Name ?? engineId>",
  "externalId": "docker-engine:<engine-id>",   // = sourceIdentity verbatim, unqualified
  "details": {
    "serverVersion": "27.3.1",
    "apiVersion": "1.45",
    "os": "linux",
    "arch": "x86_64",
    "kernelVersion": "6.8.0-…",
    "cgroupDriver": "systemd",               // optional
    "runtimes": ["io.containerd.runc.v2", "runc"],  // optional — Object.keys(info.Runtimes)
    "registryMirrors": ["https://mirror.example"], // optional — omitted when empty
    "swarmNodeState": "active",              // optional — info.Swarm.LocalNodeState
    "swarmControlAvailable": true,           // optional — info.Swarm.ControlAvailable
    "swarmManagers": 3                       // optional — only when /info reports managers
  },
  "instances": [
    { "externalId": "docker-engine:<id>::engine", "environment": "OTHER",
      "status": "RUNNING", "rawConfig": {} }
  ]
}
```

Excluded `/info`/`/version` fields — never declared on the local
interface: `DockerRootDir`, `HTTPProxy`/`HTTPSProxy`/`FTPProxy`/
`NO_PROXY` (any case), `Plugins`, `SecurityOptions`, `Warnings`.

## Image asset `details` (additive, `includeImages` only)

Existing keys (`imageId`, `size`, `created`) unchanged; inspect merge
adds, per unique `image.Id`:

```jsonc
{
  "ociLabels": {                             // Config.Labels ∩ 10-key allowlist
    "org.opencontainers.image.source": "https://github.com/org/repo",
    "org.opencontainers.image.revision": "abc123",
    "org.opencontainers.image.version": "1.2.3",
    "org.opencontainers.image.vendor": "…",
    "org.opencontainers.image.licenses": "Apache-2.0",
    "org.opencontainers.image.description": "…",
    "org.opencontainers.image.title": "…",
    "org.opencontainers.image.url": "…",
    "org.opencontainers.image.documentation": "…",
    "org.opencontainers.image.source-label": "…"
  },                                       // omitted when no allowlisted labels
  "exposedPorts": ["8080/tcp", "443/tcp"],   // Object.keys(Config.ExposedPorts)
  "user": "node",                            // Config.User — optional
  "entrypoint": ["node", "server.js"],        // Config.Entrypoint — optional
  "workingDir": "/app",                      // Config.WorkingDir — optional
  "volumes": ["/data"],                      // Object.keys(Config.Volumes)
  "architecture": "amd64",                   // top-level Architecture
  "os": "linux"                              // top-level Os
}
```

Failed inspect → asset emits with pre-feature `details` only.
Multiple refs (tags/digests) sharing one `image.Id` each get the same
merged details; inspect runs once per unique `Id`.

## Validation rules

- Every emitted asset passes `validateDiscoveredAsset` (existing check at
  each yield site — engine asset included).
- No new entity, table, enum, or CHECK constraint.
- `environment` on the engine instance is `OTHER` (engine is not
  env-scoped); container/swarm instances keep their existing mapping.
