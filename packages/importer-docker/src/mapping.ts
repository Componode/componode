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
    FinishedAt?: string;
    OOMKilled?: boolean;
    Restarting?: boolean;
    // Health.Log is deliberately NOT declared — check output and test
    // commands are on the exclusion list (ADR-121 Amendment 1).
    Health?: {
      Status?: string;
      FailingStreak?: number;
    };
  };
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

// Health-aware status (ADR-121 Amendment 1, spec 047): engine state
// decides first, OOMKilled overrides, then a failing health check
// degrades a running container to ERROR. `starting` health is
// inconclusive, not failure; unknown states fail closed.
export function mapStatus(
  state: ContainerInspect["State"],
): InstanceStatus {
  if (state?.OOMKilled) return "ERROR";
  switch (state?.Status) {
    case "running":
      return state?.Health?.Status === "unhealthy" ? "ERROR" : "RUNNING";
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

// Docker reports a zero-time ("0001-01-01T00:00:00Z") for never-started
// containers — map it to null, not a bogus 1-CE date.
const dockerTime = (t?: string) =>
  t && !t.startsWith("0001-01-01") ? t : null;

// Non-zero exit code travels as a fact on both the instance fields and the
// observation; a clean exit (0) is noise and is omitted.
const nonZeroExit = (state: ContainerInspect["State"]) =>
  state?.ExitCode ? { exitCode: state.ExitCode } : {};

// Allowlisted observation snapshot (ADR-121 Amendment 1): engine state +
// latest health-check facts only. Health.Log (check output) and
// Config.Healthcheck.Test (command) are never read.
function mapObservation(state: ContainerInspect["State"]) {
  const health = state?.Health;
  return {
    state: state?.Status ?? "unknown",
    ...nonZeroExit(state),
    ...(state?.OOMKilled ? { oomKilled: true } : {}),
    ...(state?.Restarting ? { restarting: true } : {}),
    startedAt: dockerTime(state?.StartedAt),
    finishedAt: dockerTime(state?.FinishedAt),
    // "none" means no usable check data — represent absence as null.
    health:
      health?.Status && health.Status !== "none"
        ? {
            status: health.Status,
            ...(health.FailingStreak && health.FailingStreak > 0
              ? { failingStreak: health.FailingStreak }
              : {}),
          }
        : null,
  };
}

export function mapContainer(
  inspect: ContainerInspect,
  sourceIdentity: string,
  envLabel: string | undefined,
  envMap: Record<string, Environment> | undefined,
  componentIdLabel: string,
): MappedContainer {
  // FR-011: container Config.Labels already include Compose service
  // labels — Docker merges them at container create, so this read IS the
  // service-label fallback the spec names; there is no second lookup.
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
    status: mapStatus(state),
    deployedAt: dockerTime(state?.StartedAt),
    rawConfig: {
      containerName: (inspect.Name ?? "").replace(/^\/+/, ""),
      imageRef,
      ...(digest ? { imageDigest: digest } : {}),
      state: state?.Status ?? "unknown",
      ...nonZeroExit(state),
      ports: mapPorts(inspect.NetworkSettings?.Ports),
      networks: Object.keys(inspect.NetworkSettings?.Networks ?? {}),
      mounts: mapMounts(inspect.Mounts, inspect.Id),
      dockerObservation: mapObservation(state),
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
