import type {
  DiscoveredAsset,
  DiscoveredAssetInstance,
  Environment,
  InstanceStatus,
} from "@componode/core";
import {
  workloadIdentity,
  instanceExternalId,
  type WorkloadIdentity,
} from "./identity.js";

// Allowlisted label keys/prefixes carried into sourceDetails (data
// minimization, ADR-121) — never Config.Env, HostConfig, health output,
// or raw bind paths.
const ALLOWED_LABEL_PREFIXES = ["com.docker.compose.", "componode."];

export interface ContainerInspect {
  Id: string;
  Name: string;
  Config?: { Image?: string; Labels?: Record<string, string> };
  State?: {
    Status?: string;
    ExitCode?: number;
    StartedAt?: string;
  };
  HostConfig?: { RestartPolicy?: { Name?: string } };
  Mounts?: Array<{
    Type?: string;
    Destination?: string;
    Name?: string;
  }>;
  NetworkSettings?: {
    Ports?: Record<
      string,
      Array<{ HostIp?: string; HostPort?: string }> | null
    >;
    Networks?: Record<string, unknown>;
  };
  RepoDigests?: string[];
}

// Wave C: engine state only (clarified 2026-11-01) — health-check
// results do not influence status; dockerObservation ships in Wave D.
export function mapStateToStatus(
  state: string | undefined,
): InstanceStatus {
  switch (state) {
    case "running":
      return "RUNNING";
    case "created":
    case "paused":
    case "exited":
      return "STOPPED";
    default:
      return "ERROR"; // dead/restarting/removing/unknown — fail closed
  }
}

function allowedLabels(
  labels: Record<string, string> | undefined,
  envLabel?: string,
) {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(labels ?? {})) {
    if (
      ALLOWED_LABEL_PREFIXES.some((p) => k.startsWith(p)) ||
      k === envLabel
    ) {
      out[k] = v;
    }
  }
  return out;
}

function mapMounts(mounts: ContainerInspect["Mounts"], containerId: string) {
  return (mounts ?? []).map((m) => ({
    type: m.Type ?? "unknown",
    destination: m.Destination ?? "",
    // Bind sources are opaque importer-local refs — never raw paths.
    ref:
      m.Type === "volume" && m.Name
        ? `volume:${m.Name}`
        : `bind:${containerId}:${m.Destination ?? "unknown"}`,
  }));
}

function mapPorts(
  ports:
    | Record<
        string,
        Array<{ HostIp?: string; HostPort?: string }> | null
      >
    | undefined,
) {
  const out: Array<{
    container: string;
    published: Array<{ hostIp?: string; hostPort?: string }>;
  }> = [];
  for (const [containerPort, bindings] of Object.entries(ports ?? {})) {
    out.push({
      container: containerPort,
      published: (bindings ?? []).map((b) => ({
        hostIp: b?.HostIp,
        hostPort: b?.HostPort,
      })),
    });
  }
  return out;
}

export interface MappedContainer {
  identity: WorkloadIdentity;
  instance: DiscoveredAssetInstance;
}

export function mapContainer(
  inspect: ContainerInspect,
  sourceIdentity: string,
  envLabel: string | undefined,
  envMap: Record<string, Environment> | undefined,
  componentIdLabel: string,
): MappedContainer {
  const labels = inspect.Config?.Labels ?? {};
  const identity = workloadIdentity(
    labels,
    inspect.Name ?? "",
    sourceIdentity,
    componentIdLabel,
  );
  const labelEnv = envLabel ? labels[envLabel] : undefined;
  const environment: Environment =
    (labelEnv && envMap?.[labelEnv]) || "OTHER";
  const state = inspect.State;
  const imageRef = inspect.Config?.Image ?? "";
  const digest = (inspect.RepoDigests ?? [])[0];

  const instance: DiscoveredAssetInstance = {
    externalId: instanceExternalId(sourceIdentity, inspect.Id),
    environment,
    status: mapStateToStatus(state?.Status),
    rawConfig: {
      containerName: (inspect.Name ?? "").replace(/^\/+/, ""),
      imageRef,
      ...(digest ? { imageDigest: digest } : {}),
      state: state?.Status ?? "unknown",
      ...(state?.ExitCode !== undefined && state.ExitCode !== 0
        ? { exitCode: state.ExitCode }
        : {}),
      ...(state?.StartedAt ? { startedAt: state.StartedAt } : {}),
      ports: mapPorts(inspect.NetworkSettings?.Ports),
      networks: Object.keys(inspect.NetworkSettings?.Networks ?? {}),
      mounts: mapMounts(inspect.Mounts, inspect.Id),
      restartPolicy: inspect.HostConfig?.RestartPolicy?.Name ?? "",
    },
    sourceDetails: {
      labels: allowedLabels(labels, envLabel),
    },
  };

  return { identity, instance };
}

export function buildAsset(
  identity: WorkloadIdentity,
  instances: DiscoveredAssetInstance[],
  imageRef: string,
): DiscoveredAsset {
  const name =
    identity.workloadId ??
    (identity.composeProject
      ? `${identity.composeProject}/${identity.composeService}`
      : identity.externalId.split("::").pop()!);
  return {
    category: "CONTAINER",
    provider: "DOCKER",
    resourceType:
      identity.kind === "compose" ? "compose-service" : "container",
    name,
    externalId: identity.externalId,
    details: {
      workloadKind: identity.kind,
      ...(identity.composeProject
        ? { composeProject: identity.composeProject }
        : {}),
      ...(identity.composeService
        ? { composeService: identity.composeService }
        : {}),
      ...(identity.workloadId ? { workloadId: identity.workloadId } : {}),
      imageRef,
    },
    sourceDetails: {
      composeProject: identity.composeProject ?? null,
      composeService: identity.composeService ?? null,
      workloadId: identity.workloadId ?? null,
    },
    instances,
  };
}
