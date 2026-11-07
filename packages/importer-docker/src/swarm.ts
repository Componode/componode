import type {
  DiscoveredAsset,
  DiscoveredAssetInstance,
  Environment,
  InstanceStatus,
} from "@componode/core";
import { qualifyExternalId } from "@componode/core";
import { instanceExternalId } from "./identity.js";

// Swarm inventory (ADR-121 Amendment 2): local allowlist interfaces —
// dockerode Swarm responses are loosely typed, so only the fields the
// contract names are declared/read. Task lists, task inspect, logs,
// events, and secret/config contents are never fetched or read.

export interface SwarmService {
  ID: string;
  Spec?: {
    Name?: string;
    Labels?: Record<string, string>;
    Mode?: {
      Replicated?: { Replicas?: number };
      Global?: object;
      ReplicatedJob?: object;
      GlobalJob?: object;
    };
    EndpointSpec?: {
      Ports?: {
        Protocol?: string;
        TargetPort?: number;
        PublishedPort?: number;
        PublishMode?: string;
      }[];
    };
    Networks?: { Target?: string }[];
    TaskTemplate?: {
      ContainerSpec?: { Image?: string };
      Secrets?: { SecretID?: string; SecretName?: string }[];
      Configs?: { ConfigID?: string; ConfigName?: string }[];
    };
  };
  ServiceStatus?: {
    RunningTasks?: number;
    DesiredTasks?: number;
    CompletedTasks?: number;
  };
  UpdateStatus?: { State?: string };
  CreatedAt?: string;
}

export interface SwarmNode {
  ID: string;
  Spec?: {
    Name?: string;
    Role?: string;
    Availability?: string;
  };
  Status?: { State?: string; Addr?: string };
  ManagerStatus?: { Reachability?: string; Leader?: boolean };
}

export interface SwarmSecret {
  ID: string;
  Spec?: { Name?: string };
  Version?: { Index?: number };
}

// Replica status table (contract): desired>0 && running===desired →
// RUNNING; desired>0 && running<desired → ERROR; desired===0 → STOPPED.
export function swarmServiceStatus(running: number, desired: number): InstanceStatus {
  if (desired === 0) return "STOPPED";
  return running === desired ? "RUNNING" : "ERROR";
}

// Node table: intentional availability (drain/pause) → STOPPED; else
// ready+reachable → RUNNING; everything else fails closed → ERROR.
export function swarmNodeStatus(node: SwarmNode): InstanceStatus {
  const availability = node.Spec?.Availability;
  if (availability === "drain" || availability === "pause") return "STOPPED";
  const ready = node.Status?.State === "ready";
  const active = availability === "active";
  const reachable = node.ManagerStatus?.Reachability !== "unreachable";
  return ready && active && reachable ? "RUNNING" : "ERROR";
}

// Service mode (spec 064): job types checked before the replicated/global
// fallbacks — ReplicatedJob/GlobalJob are distinct Mode members, and job
// services stay CONTAINER_ORCHESTRATION (mode is an observation only).
export function swarmServiceMode(svc: SwarmService): string {
  const mode = svc.Spec?.Mode;
  if (mode?.ReplicatedJob !== undefined) return "replicated-job";
  if (mode?.GlobalJob !== undefined) return "global-job";
  return mode?.Global !== undefined ? "global" : "replicated";
}

// Published ports from Spec.EndpointSpec — flat entries carrying
// protocol/target/published(/publishMode); shares the `ports` key with
// container instances (entry shape differs by design).
function mapSwarmPorts(svc: SwarmService) {
  const ports = (svc.Spec?.EndpointSpec?.Ports ?? [])
    .filter((p) => p.TargetPort !== undefined)
    .map((p) => ({
      protocol: p.Protocol ?? "tcp",
      target: p.TargetPort,
      ...(p.PublishedPort !== undefined ? { published: p.PublishedPort } : {}),
      ...(p.PublishMode ? { publishMode: p.PublishMode } : {}),
    }));
  return ports.length ? ports : undefined;
}

function mapSwarmNetworks(svc: SwarmService) {
  const networks = (svc.Spec?.Networks ?? [])
    .map((n) => n.Target)
    .filter((t): t is string => Boolean(t));
  return networks.length ? networks : undefined;
}

export function mapSwarmService(
  svc: SwarmService,
  sourceIdentity: string,
  envLabel: string | undefined,
  envMap: Record<string, Environment> | undefined,
): DiscoveredAsset {
  const name = svc.Spec?.Name ?? svc.ID;
  const labels = svc.Spec?.Labels ?? {};
  const stack = labels["com.docker.stack.namespace"] ?? null;
  const mode = swarmServiceMode(svc);
  // Manager-reported ServiceStatus counts are the contract's source of
  // truth for both modes; Spec.Replicas is only a fallback when the
  // manager didn't report (never during normal `status=1` listing).
  const desired =
    svc.ServiceStatus?.DesiredTasks ??
    svc.Spec?.Mode?.Replicated?.Replicas ??
    0;
  const running = svc.ServiceStatus?.RunningTasks ?? 0;
  const completed = svc.ServiceStatus?.CompletedTasks;
  const updateState = svc.UpdateStatus?.State;
  const labelEnv = envLabel ? labels[envLabel] : undefined;
  const environment: Environment = (labelEnv && envMap?.[labelEnv]) || "OTHER";
  const secretRefs = (svc.Spec?.TaskTemplate?.Secrets ?? [])
    .map((s) => ({ id: s.SecretID ?? "", name: s.SecretName ?? "" }))
    .filter((r) => r.id && r.name);
  const configRefs = (svc.Spec?.TaskTemplate?.Configs ?? [])
    .map((c) => ({ id: c.ConfigID ?? "", name: c.ConfigName ?? "" }))
    .filter((r) => r.id && r.name);
  const ports = mapSwarmPorts(svc);
  const networks = mapSwarmNetworks(svc);

  const instance: DiscoveredAssetInstance = {
    externalId: instanceExternalId(sourceIdentity, `swarm-service:${svc.ID}`),
    environment,
    status: swarmServiceStatus(running, desired),
    version: svc.Spec?.TaskTemplate?.ContainerSpec?.Image ?? null,
    deployedAt: svc.CreatedAt ?? null,
    rawConfig: {
      swarmObservation: {
        mode,
        desired,
        running,
        ...(completed ? { completed } : {}),
        ...(updateState ? { updateState } : {}),
        observedAt: new Date().toISOString(),
      },
      ...(ports ? { ports } : {}),
      ...(networks ? { networks } : {}),
    },
    sourceDetails: { stack, serviceId: svc.ID },
  };

  return {
    category: "CONTAINER_ORCHESTRATION",
    provider: "DOCKER",
    resourceType: "swarm-service",
    name,
    externalId: qualifyExternalId(sourceIdentity, `swarm-service:${name}`),
    details: {
      mode,
      ...(stack ? { stack } : {}),
      ...(svc.Spec?.TaskTemplate?.ContainerSpec?.Image
        ? { image: svc.Spec.TaskTemplate.ContainerSpec.Image }
        : {}),
      ...(secretRefs.length ? { secretRefs } : {}),
      ...(configRefs.length ? { configRefs } : {}),
      ...(updateState ? { updateState } : {}),
    },
    sourceDetails: { stack, serviceId: svc.ID },
    instances: [instance],
  };
}

export function mapSwarmNode(
  node: SwarmNode,
  sourceIdentity: string,
): DiscoveredAsset {
  const name = node.Spec?.Name ?? node.ID;
  const role = node.Spec?.Role ?? "worker";
  const availability = node.Spec?.Availability ?? "unknown";
  const reachability = node.ManagerStatus?.Reachability ?? null;
  const leader = node.ManagerStatus?.Leader === true;
  const state = node.Status?.State ?? "unknown";

  const instance: DiscoveredAssetInstance = {
    externalId: instanceExternalId(sourceIdentity, `swarm-node:${node.ID}`),
    environment: "OTHER",
    status: swarmNodeStatus(node),
    rawConfig: {
      swarmNodeObservation: {
        role,
        availability,
        reachability,
        leader,
        state,
        addr: node.Status?.Addr ?? null,
      },
    },
    sourceDetails: { role, availability },
  };

  return {
    category: "COMPUTE",
    provider: "DOCKER",
    resourceType: "swarm-node",
    name,
    externalId: qualifyExternalId(sourceIdentity, `swarm-node:${name}`),
    details: { role, availability, reachability, leader },
    sourceDetails: { role, availability },
    instances: [instance],
  };
}

// Secrets are metadata-only inventory — Spec.Name + Version.Index only;
// contents are never read or fetched (ADR-121 Amendment 2).
export function mapSwarmSecret(
  secret: SwarmSecret,
  sourceIdentity: string,
): DiscoveredAsset {
  const name = secret.Spec?.Name ?? secret.ID;
  return {
    category: "SECRET",
    provider: "DOCKER",
    resourceType: "swarm-secret",
    name,
    externalId: qualifyExternalId(sourceIdentity, `swarm-secret:${name}`),
    details: {
      secretId: secret.ID,
      ...(secret.Version?.Index !== undefined ? { revision: secret.Version.Index } : {}),
    },
    instances: [],
  };
}
