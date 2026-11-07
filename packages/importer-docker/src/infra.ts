import type { DiscoveredAsset } from "@componode/core";
import { qualifyExternalId } from "@componode/core";
import { allowedLabels } from "./mapping.js";

// Infrastructure inventory (spec 065 / ADR-121 Amendment 4): NETWORK and
// STORAGE components with instances: [] — point-in-time facts in
// `details`, sourced from /networks + per-network inspect and
// /volumes + /system/df. Excluded fields (IPAM, Options, endpoint
// addressing, Mountpoint, Status) are deliberately NEVER declared on
// these interfaces — they cannot leak into emitted assets.

export interface NetworkEndpoint {
  Name?: string;
}

// GET /networks/{id} inspect — the full Network representation. The
// /networks LIST omits Containers on API >= 1.28, so attachments are
// always inspect-sourced (research.md R2).
export interface NetworkInspect {
  Id?: string;
  Name?: string;
  Created?: string;
  Scope?: string;
  Driver?: string;
  EnableIPv6?: boolean;
  Internal?: boolean;
  Attachable?: boolean;
  Ingress?: boolean;
  ConfigOnly?: boolean;
  Labels?: Record<string, string>;
  Containers?: Record<string, NetworkEndpoint>;
}

export function mapNetwork(
  network: NetworkInspect,
  sourceIdentity: string,
): DiscoveredAsset {
  const name = network.Name ?? network.Id ?? "";
  const scope = network.Scope ?? "local";

  const details: Record<string, unknown> = {};
  const put = (key: string, value: unknown) => {
    if (value !== undefined) details[key] = value;
  };
  put("driver", network.Driver);
  details.scope = scope;
  put("createdAt", network.Created);
  if (network.Internal) details.internal = true;
  if (network.Attachable) details.attachable = true;
  if (network.Ingress) details.ingress = true;
  if (network.ConfigOnly) details.configOnly = true;
  if (network.EnableIPv6) details.enableIPv6 = true;

  const attached = Object.values(network.Containers ?? {})
    .map((e) => e?.Name)
    .filter((n): n is string => Boolean(n));
  details.attachedCount = attached.length;
  if (attached.length) details.attachedContainers = attached;

  const labels = allowedLabels(network.Labels);
  if (Object.keys(labels).length) details.labels = labels;

  return {
    category: "NETWORK",
    provider: "DOCKER",
    resourceType: "network",
    name,
    externalId: qualifyExternalId(
      sourceIdentity,
      `network:${scope}:${name}`,
    ),
    details,
    instances: [],
  };
}

// Volume fields we consume — Mountpoint/Options/Status/UsageData are
// deliberately NEVER declared here (ADR-121 A4).
export interface VolumeSummary {
  Name: string;
  Driver?: string;
  CreatedAt?: string;
  Scope?: string;
  Labels?: Record<string, string>;
}

// UsageData is only populated by GET /system/df?type=volume (research R3);
// Size/RefCount use -1 as the "not available" sentinel.
export interface VolumeUsageData {
  Size?: number;
  RefCount?: number;
  Reclaimable?: boolean;
}

export function mapVolume(
  volume: VolumeSummary,
  usage: VolumeUsageData | undefined,
  sourceIdentity: string,
): DiscoveredAsset {
  const details: Record<string, unknown> = {};
  const put = (key: string, value: unknown) => {
    if (value !== undefined) details[key] = value;
  };
  put("driver", volume.Driver);
  details.scope = volume.Scope ?? "local";
  put("createdAt", volume.CreatedAt);
  if (typeof usage?.Size === "number" && usage.Size >= 0) {
    details.sizeBytes = usage.Size;
  }
  if (typeof usage?.RefCount === "number" && usage.RefCount >= 0) {
    details.refCount = usage.RefCount;
  }
  if (typeof usage?.Reclaimable === "boolean") {
    details.reclaimable = usage.Reclaimable;
  }
  const labels = allowedLabels(volume.Labels);
  if (Object.keys(labels).length) details.labels = labels;

  return {
    category: "STORAGE",
    provider: "DOCKER",
    resourceType: "volume",
    name: volume.Name,
    externalId: qualifyExternalId(sourceIdentity, `volume:${volume.Name}`),
    details,
    instances: [],
  };
}
