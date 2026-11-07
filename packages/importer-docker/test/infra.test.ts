import { describe, it, expect } from "vitest";
import {
  mapNetwork,
  mapVolume,
  type NetworkInspect,
} from "../src/infra.js";
import { validateDiscoveredAsset } from "@componode/core";

// spec 065 / contracts/infra-assets.md — NETWORK components from
// /networks + per-network inspect; exclusions per ADR-121 A4.
const SRC = "docker-engine:eng-1";

const SWARM_NET: NetworkInspect = {
  Id: "net-id-1",
  Name: "frontend",
  Created: "2026-10-01T12:00:00Z",
  Scope: "swarm",
  Driver: "overlay",
  EnableIPv6: true,
  Internal: true,
  Attachable: true,
  Ingress: true,
  ConfigOnly: false,
  Labels: {
    "com.docker.compose.project": "myapp",
    "com.example.internal": "drop-me",
  },
  Containers: {
    "ep-1": { Name: "web-1", EndpointID: "ep-1", MacAddress: "02:42:ac:13:00:02", IPv4Address: "10.0.0.2/24" },
    "ep-2": { Name: "api-1", EndpointID: "ep-2", MacAddress: "02:42:ac:13:00:03", IPv4Address: "10.0.0.3/24" },
  },
};

describe("mapNetwork (spec 065)", () => {
  it("emits a NETWORK/docker component with scope-qualified identity", () => {
    const a = mapNetwork(SWARM_NET, SRC);
    expect(a.category).toBe("NETWORK");
    expect(a.provider).toBe("DOCKER");
    expect(a.resourceType).toBe("network");
    expect(a.name).toBe("frontend");
    expect(a.externalId).toBe("docker-engine:eng-1::network:swarm:frontend");
    expect(a.instances).toEqual([]);
    expect(validateDiscoveredAsset(a)).toBe(true);
  });

  it("keeps same-named networks in different scopes distinct", () => {
    const local = mapNetwork({ ...SWARM_NET, Scope: "local", Driver: "bridge" }, SRC);
    const swarm = mapNetwork(SWARM_NET, SRC);
    expect(local.externalId).not.toBe(swarm.externalId);
    expect(local.externalId).toBe("docker-engine:eng-1::network:local:frontend");
  });

  it("carries the bounded details allowlist", () => {
    const a = mapNetwork(SWARM_NET, SRC);
    expect(a.details).toEqual({
      driver: "overlay",
      scope: "swarm",
      internal: true,
      attachable: true,
      ingress: true,
      enableIPv6: true,
      createdAt: "2026-10-01T12:00:00Z",
      attachedCount: 2,
      attachedContainers: ["web-1", "api-1"],
      labels: { "com.docker.compose.project": "myapp" },
    });
  });

  it("omits false flags, empty attachments, and empty labels", () => {
    const a = mapNetwork(
      {
        Id: "n2",
        Name: "bridge",
        Scope: "local",
        Driver: "bridge",
        Created: "0001-01-01T00:00:00Z",
        Internal: false,
        Attachable: false,
        Ingress: false,
        ConfigOnly: false,
        EnableIPv6: false,
        Labels: { "com.example.drop": "x" },
        Containers: {},
      },
      SRC,
    );
    expect(a.details).toEqual({
      driver: "bridge",
      scope: "local",
      createdAt: "0001-01-01T00:00:00Z",
      attachedCount: 0,
    });
    expect(a.details).not.toHaveProperty("labels");
    expect(a.details).not.toHaveProperty("attachedContainers");
  });

  it("never emits excluded fields even when present in the payload", () => {
    const hostile = {
      ...SWARM_NET,
      IPAM: { Driver: "default", Config: [{ Subnet: "10.0.0.0/24", Gateway: "10.0.0.1" }] },
      Options: { "com.docker.network.bridge.name": "docker0", "host_binding_ipv4": "192.168.1.10" },
      Containers: {
        "ep-9": {
          Name: "web-9",
          EndpointID: "ep-9-secret",
          MacAddress: "02:42:ff:ff:ff:ff",
          IPv4Address: "10.9.9.9/24",
          IPv6Address: "fd00::9/64",
          GlobalIPv6Address: "2001:db8::9",
        },
      },
    } as NetworkInspect;
    const a = mapNetwork(hostile, SRC);
    const json = JSON.stringify(a);
    for (const bad of [
      "IPAM",
      "10.0.0.0/24",
      "10.0.0.1",
      "Options",
      "docker0",
      "192.168.1.10",
      "ep-9-secret",
      "02:42:ff:ff:ff:ff",
      "10.9.9.9",
      "fd00::9",
      "2001:db8::9",
    ]) {
      expect(json).not.toContain(bad);
    }
    // endpoint Name still surfaces via attachedContainers
    expect(a.details?.attachedContainers).toEqual(["web-9"]);
  });

  it("falls back to Id for name and local for scope when unreported", () => {
    const a = mapNetwork({ Id: "net-xyz" }, SRC);
    expect(a.name).toBe("net-xyz");
    expect(a.externalId).toBe("docker-engine:eng-1::network:local:net-xyz");
    expect(validateDiscoveredAsset(a)).toBe(true);
  });
});

const DATA_VOL = {
  Name: "pgdata",
  Driver: "local",
  CreatedAt: "2026-09-15T08:30:00Z",
  Scope: "local",
  Labels: { "com.docker.compose.project": "shop", "com.acme.tag": "drop" },
};

const DATA_USAGE = { Size: 10920104, RefCount: 2, Reclaimable: true };

describe("mapVolume (spec 065)", () => {
  it("emits a STORAGE/docker component keyed by volume name", () => {
    const a = mapVolume(DATA_VOL, DATA_USAGE, SRC);
    expect(a.category).toBe("STORAGE");
    expect(a.provider).toBe("DOCKER");
    expect(a.resourceType).toBe("volume");
    expect(a.name).toBe("pgdata");
    expect(a.externalId).toBe("docker-engine:eng-1::volume:pgdata");
    expect(a.instances).toEqual([]);
    expect(validateDiscoveredAsset(a)).toBe(true);
  });

  it("carries the bounded details allowlist with usage facts", () => {
    const a = mapVolume(DATA_VOL, DATA_USAGE, SRC);
    expect(a.details).toEqual({
      driver: "local",
      scope: "local",
      createdAt: "2026-09-15T08:30:00Z",
      sizeBytes: 10920104,
      refCount: 2,
      reclaimable: true,
      labels: { "com.docker.compose.project": "shop" },
    });
  });

  it("omits usage fields absent from df or reported as -1 sentinels", () => {
    const noUsage = mapVolume(DATA_VOL, undefined, SRC);
    expect(noUsage.details).not.toHaveProperty("sizeBytes");
    expect(noUsage.details).not.toHaveProperty("refCount");
    expect(noUsage.details).not.toHaveProperty("reclaimable");

    const sentinel = mapVolume(DATA_VOL, { Size: -1, RefCount: -1 }, SRC);
    expect(sentinel.details).not.toHaveProperty("sizeBytes");
    expect(sentinel.details).not.toHaveProperty("refCount");
    expect(sentinel.details?.refCount).not.toBe(-1);

    const zeroOk = mapVolume(DATA_VOL, { Size: 0, RefCount: 0, Reclaimable: false }, SRC);
    expect(zeroOk.details).toMatchObject({ sizeBytes: 0, refCount: 0, reclaimable: false });
  });

  it("never emits Mountpoint, Options, Status, or unbounded labels", () => {
    const hostile = {
      ...DATA_VOL,
      Mountpoint: "/var/lib/docker/volumes/pgdata/_data",
      Options: { type: "nfs", o: "addr=10.0.0.9,rw", device: ":/srv/pg" },
      Status: { "com.docker.compose.project.working_dir": "/srv" },
      Labels: { "com.acme.secret": "x", "componode.env": "prod" },
    } as Parameters<typeof mapVolume>[0];
    const a = mapVolume(hostile, DATA_USAGE, SRC);
    const json = JSON.stringify(a);
    for (const bad of [
      "Mountpoint",
      "/var/lib/docker/volumes",
      "Options",
      "addr=10.0.0.9",
      ":/srv/pg",
      "Status",
      "com.acme.secret",
      "working_dir",
    ]) {
      expect(json).not.toContain(bad);
    }
    expect(a.details?.labels).toEqual({ "componode.env": "prod" });
  });
});

describe("label boundary (spec 065 / ADR-121 A4)", () => {
  it("preserves com.docker.compose.*, componode.*, and env labels on both asset types", () => {
    const labels = {
      "com.docker.compose.project": "shop",
      "com.docker.compose.service": "web",
      "componode.component-id": "api-1",
      "componode.env": "prod",
      "com.example.internal": "drop",
      "internal.note": "drop",
    };
    const net = mapNetwork({ Id: "n", Name: "n1", Scope: "local", Labels: labels }, SRC);
    const vol = mapVolume({ Name: "v1", Labels: labels }, undefined, SRC);
    const expected = {
      "com.docker.compose.project": "shop",
      "com.docker.compose.service": "web",
      "componode.component-id": "api-1",
      "componode.env": "prod",
    };
    expect(net.details?.labels).toEqual(expected);
    expect(vol.details?.labels).toEqual(expected);
  });

  it("omits the labels key entirely when nothing survives the allowlist", () => {
    const empty = mapNetwork({ Id: "n", Name: "n1", Scope: "local", Labels: {} }, SRC);
    expect(empty.details).not.toHaveProperty("labels");
    const absent = mapVolume({ Name: "v1" }, undefined, SRC);
    expect(absent.details).not.toHaveProperty("labels");
    const onlyDropped = mapNetwork(
      { Id: "n", Name: "n1", Scope: "local", Labels: { "com.acme.x": "y" } },
      SRC,
    );
    expect(onlyDropped.details).not.toHaveProperty("labels");
  });
});
