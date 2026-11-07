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
  /** Immutable image ID (`sha256:…`) — joins image assets' details.imageId. */
  Image?: string;
  Config?: {
    Image?: string;
    Labels?: Record<string, string>;
    // Healthcheck.Test is deliberately NOT declared — the check command
    // is on the ADR-121 exclusion list; only timing fields are read.
    Healthcheck?: {
      Interval?: number;
      Timeout?: number;
      Retries?: number;
      StartPeriod?: number;
    };
  };
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
  // HostConfig.Binds/Mounts and LogConfig.Config are deliberately NOT
  // declared — raw host paths and driver options never leave the engine
  // boundary (ADR-121 Amendment 3). Only the bounded fact fields below.
  HostConfig?: {
    Memory?: number;
    NanoCpus?: number;
    PidsLimit?: number;
    RestartPolicy?: { Name?: string; MaximumRetryCount?: number };
    Privileged?: boolean;
    ReadonlyRootfs?: boolean;
    LogConfig?: { Type?: string };
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

// Bounded host-config facts (spec 064 / ADR-121 Amendment 3): capacity,
// restart policy, and posture booleans — never Binds, Mounts sources,
// LogConfig.Config driver options, or Env. Objects emit only when the
// engine reports something; booleans only when true.
function mapHostConfig(hc: ContainerInspect["HostConfig"]) {
  if (!hc) return undefined;
  const restartPolicy = hc.RestartPolicy?.Name
    ? {
        mode: hc.RestartPolicy.Name,
        ...(hc.RestartPolicy.MaximumRetryCount &&
        hc.RestartPolicy.MaximumRetryCount > 0
          ? { maxRetries: hc.RestartPolicy.MaximumRetryCount }
          : {}),
      }
    : undefined;
  const out = {
    // Docker's unset sentinels (Memory:0, NanoCpus:0, PidsLimit:-1/0)
    // mean "no limit" — emit only positive values so unlimited containers
    // don't surface as zeroed facts (US1 AC2).
    ...(hc.Memory !== undefined && hc.Memory > 0
      ? { memoryBytes: hc.Memory }
      : {}),
    ...(hc.NanoCpus !== undefined && hc.NanoCpus > 0
      ? { nanoCpus: hc.NanoCpus }
      : {}),
    ...(hc.PidsLimit !== undefined && hc.PidsLimit > 0
      ? { pidsLimit: hc.PidsLimit }
      : {}),
    ...(restartPolicy ? { restartPolicy } : {}),
    ...(hc.Privileged ? { privileged: true } : {}),
    ...(hc.ReadonlyRootfs ? { readOnlyRootfs: true } : {}),
    ...(hc.LogConfig?.Type ? { logDriver: hc.LogConfig.Type } : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

// Health-check *definition* timings (Config.Healthcheck) in seconds —
// distinct from dockerObservation.health, which is runtime status.
// nanoseconds → seconds; the Test command is never read.
type HealthcheckConfig = NonNullable<
  NonNullable<ContainerInspect["Config"]>["Healthcheck"]
>;

function mapHealthcheck(hc: HealthcheckConfig | undefined) {
  if (!hc) return undefined;
  const s = (ns?: number) => (ns !== undefined ? ns / 1e9 : undefined);
  const out = {
    ...(s(hc.Interval) !== undefined
      ? { intervalSeconds: s(hc.Interval) }
      : {}),
    ...(s(hc.Timeout) !== undefined
      ? { timeoutSeconds: s(hc.Timeout) }
      : {}),
    ...(hc.Retries !== undefined ? { retries: hc.Retries } : {}),
    ...(s(hc.StartPeriod) !== undefined
      ? { startPeriodSeconds: s(hc.StartPeriod) }
      : {}),
  };
  return Object.keys(out).length ? out : undefined;
}

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
  const observation = mapObservation(state);
  const hostConfig = mapHostConfig(inspect.HostConfig);
  const healthcheck = mapHealthcheck(inspect.Config?.Healthcheck);

  const instance: DiscoveredAssetInstance = {
    externalId: instanceExternalId(sourceIdentity, inspect.Id),
    environment,
    status: mapStatus(state),
    deployedAt: observation.startedAt,
    rawConfig: {
      containerName: (inspect.Name ?? "").replace(/^\/+/, ""),
      imageRef,
      ...(digest ? { imageDigest: digest } : {}),
      ...(inspect.Image ? { imageId: inspect.Image } : {}),
      state: observation.state,
      ...nonZeroExit(state),
      ports: mapPorts(inspect.NetworkSettings?.Ports),
      networks: Object.keys(inspect.NetworkSettings?.Networks ?? {}),
      mounts: mapMounts(inspect.Mounts, inspect.Id),
      ...(hostConfig ? { hostConfig } : {}),
      ...(healthcheck ? { healthcheck } : {}),
      dockerObservation: observation,
    },
    sourceDetails: {
      labels: allowedLabels(labels, envLabel),
    },
  };

  return { identity, instance };
}

// Bounded OCI label allowlist (spec 064 / ADR-121 Amendment 3): the ten
// standard org.opencontainers.image.* keys — no other image labels.
const OCI_LABEL_ALLOWLIST = new Set([
  "org.opencontainers.image.source",
  "org.opencontainers.image.revision",
  "org.opencontainers.image.version",
  "org.opencontainers.image.vendor",
  "org.opencontainers.image.licenses",
  "org.opencontainers.image.description",
  "org.opencontainers.image.title",
  "org.opencontainers.image.url",
  "org.opencontainers.image.documentation",
  "org.opencontainers.image.source-label",
]);

export interface ImageInspect {
  Id?: string;
  Architecture?: string;
  Os?: string;
  Config?: {
    Labels?: Record<string, string>;
    User?: string;
    ExposedPorts?: Record<string, unknown>;
    Entrypoint?: string[];
    WorkingDir?: string;
    Volumes?: Record<string, unknown>;
    // Env, Cmd, OnBuild, StopSignal etc. are deliberately NOT declared —
    // they never leave the engine boundary (ADR-121).
  };
}

// Image inspect merge (spec 064): bounded OCI metadata for image asset
// details — allowlisted labels, exposed ports, user, entrypoint,
// workingDir, volumes, architecture, os. Empty collections are omitted.
export function mapImageInspectDetails(
  inspect: ImageInspect | undefined,
): Record<string, unknown> {
  if (!inspect) return {};
  const cfg = inspect.Config ?? {};
  const labels = Object.fromEntries(
    Object.entries(cfg.Labels ?? {}).filter(([k]) =>
      OCI_LABEL_ALLOWLIST.has(k),
    ),
  );
  const details: Record<string, unknown> = {};
  if (Object.keys(labels).length) details.ociLabels = labels;
  const exposedPorts = Object.keys(cfg.ExposedPorts ?? {});
  if (exposedPorts.length) details.exposedPorts = exposedPorts;
  if (cfg.User) details.user = cfg.User;
  if (cfg.Entrypoint?.length) details.entrypoint = cfg.Entrypoint;
  if (cfg.WorkingDir) details.workingDir = cfg.WorkingDir;
  const volumes = Object.keys(cfg.Volumes ?? {});
  if (volumes.length) details.volumes = volumes;
  if (inspect.Architecture) details.architecture = inspect.Architecture;
  if (inspect.Os) details.os = inspect.Os;
  return details;
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
