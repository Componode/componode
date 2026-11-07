import type { DiscoveredAsset } from "@componode/core";
import { instanceExternalId } from "./identity.js";

// Engine component (spec 064 / ADR-121 Amendment 3): one COMPUTE
// component per ImporterSource carrying bounded /info + /version facts
// in `details`. DockerRootDir, proxy vars, Plugins, SecurityOptions, and
// Warnings are deliberately NOT declared — they never leave the engine
// boundary.
export interface EngineInfo {
  ID?: string;
  Name?: string;
  ServerVersion?: string;
  OperatingSystem?: string;
  Architecture?: string;
  KernelVersion?: string;
  CgroupDriver?: string;
  Runtimes?: Record<string, unknown>;
  RegistryConfig?: { Mirrors?: string[] };
  Swarm?: {
    LocalNodeState?: string;
    ControlAvailable?: boolean;
    // moby swarm.Info: RemoteManagers is []Peer{NodeID,Addr} and the
    // total manager count is the omitempty int `Managers`.
    Managers?: number;
  };
}

export interface EngineVersion {
  Version?: string;
  ApiVersion?: string;
  Os?: string;
  Arch?: string;
  KernelVersion?: string;
}

// externalId IS the canonical source identity (`docker-engine:{id}`) —
// already globally unique, so it stays unqualified per ADR-120 (no
// `{identity}::` prefix, no double-prefixing).
export function mapEngineAsset(
  info: EngineInfo | null | undefined,
  version: EngineVersion | undefined,
  sourceIdentity: string,
): DiscoveredAsset {
  const engineId = info?.ID ?? sourceIdentity.replace(/^docker-engine:/, "");
  const name = info?.Name ?? engineId;

  const details: Record<string, unknown> = {};
  const put = (key: string, value: unknown) => {
    if (value !== undefined) details[key] = value;
  };
  put("serverVersion", info?.ServerVersion ?? version?.Version);
  put("apiVersion", version?.ApiVersion);
  put("os", info?.OperatingSystem ?? version?.Os);
  put("arch", info?.Architecture ?? version?.Arch);
  put("kernelVersion", info?.KernelVersion ?? version?.KernelVersion);
  put("cgroupDriver", info?.CgroupDriver);
  const runtimes = Object.keys(info?.Runtimes ?? {});
  if (runtimes.length) details.runtimes = runtimes;
  const mirrors = info?.RegistryConfig?.Mirrors ?? [];
  if (mirrors.length) details.registryMirrors = mirrors;
  put("swarmNodeState", info?.Swarm?.LocalNodeState);
  put("swarmControlAvailable", info?.Swarm?.ControlAvailable);
  put("swarmManagers", info?.Swarm?.Managers);

  return {
    category: "COMPUTE",
    provider: "DOCKER",
    resourceType: "docker-engine",
    name,
    externalId: sourceIdentity,
    details,
    instances: [
      {
        externalId: instanceExternalId(sourceIdentity, "engine"),
        environment: "OTHER",
        status: "RUNNING",
        rawConfig: {},
      },
    ],
  };
}
