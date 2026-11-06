# Contract: engine component + image inspect `details`

Ratified design: `researches/docker-importer-enrichment-pack.md` (spec
064). Recorded as ADR-121 **Amendment 3** by this change.

## Engine component — one per ImporterSource, always emitted

```jsonc
{
  "category": "COMPUTE",
  "provider": "DOCKER",
  "resourceType": "docker-engine",
  "name": "<info.Name ?? engineId>",
  "externalId": "docker-engine:<engine-id>",   // = canonical sourceIdentity, unqualified
  "details": {
    "serverVersion": "…", "apiVersion": "…", "os": "…", "arch": "…",
    "kernelVersion": "…",
    "cgroupDriver": "…",            // optional
    "runtimes": ["…"],              // optional — info.Runtimes keys
    "registryMirrors": ["…"],       // optional — omitted when empty
    "swarmNodeState": "…",          // optional — info.Swarm.LocalNodeState
    "swarmControlAvailable": true,  // optional
    "swarmManagers": 0              // optional — only when /info reports managers
  },
  "instances": [
    { "externalId": "docker-engine:<id>::engine", "environment": "OTHER",
      "status": "RUNNING", "rawConfig": {} }
  ]
}
```

Sourced only from `/info` + one `/version` call per run — no inventory or
per-resource calls. **Excluded forever**: `DockerRootDir`, proxy env vars
(any case), `Plugins`, `SecurityOptions`, `Warnings`.

Emission order: after `reportSourceIdentity`, before Swarm/container
inventory — the engine is the root of the run's facts.

## Image asset `details` — opt-in inspect merge (`includeImages`)

Existing `details` keys (`imageId`, `size`, `created`) unchanged. When
`includeImages` is on, each unique `image.Id` is inspected once
(`GET /images/{id}/json`, concurrency ≤ 8) and the following merge into
**every** asset emitted for refs of that image:

```jsonc
{
  "ociLabels": { … },        // Config.Labels ∩ allowlist — omitted when empty
  "exposedPorts": ["…"],     // Config.ExposedPorts keys
  "user": "…",               // Config.User — optional
  "entrypoint": ["…"],        // Config.Entrypoint — optional
  "workingDir": "…",         // Config.WorkingDir — optional
  "volumes": ["…"],          // Config.Volumes keys
  "architecture": "…",       // top-level Architecture
  "os": "…"                  // top-level Os
}
```

`ociLabels` allowlist (exactly 10 keys, prefix-matched):
`org.opencontainers.image.{source, revision, version, vendor, licenses,
description, title, url, documentation, source-label}`.

**Failure policy (ratified)**: a failed inspect omits the merge for that
image only — the asset still emits with pre-feature details; the run is
unaffected. `includeImages=false` → zero inspect calls, byte-identical
output.
