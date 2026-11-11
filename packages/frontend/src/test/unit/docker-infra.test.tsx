import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import { ComponentDetail } from "@/ux/components/catalog/component-detail";
import type { Component, ComponentInstance } from "@/ux/lib/view-types";

// spec 065 US4 — bounded infra detail rendering: named Network/Volume
// sections only, allowlisted keys, no generic details dump.
vi.mock("@/ux/components/catalog/component-edit-dialog", () => ({
  ComponentEditDialog: () => null,
}));
vi.mock("@/ux/components/catalog/url-checks-card", () => ({
  UrlChecksCard: () => null,
  OutcomeDots: () => null,
}));

const wrap = (el: React.ReactElement) =>
  render(
    <MemoryRouter>
      <TooltipProvider>{el}</TooltipProvider>
    </MemoryRouter>,
  );

function component(over: Partial<Component> = {}): Component {
  return {
    id: "c1",
    name: "frontend",
    slug: "frontend",
    category: "NETWORK",
    provider: "DOCKER",
    resourceType: "network",
    lifecycle: "ACTIVE",
    componentGroups: [],
    teamOwnerId: null,
    teamOwnerName: null,
    tags: [],
    sunsetAt: null,
    links: [],
    instanceCount: 0,
    instances: [] as ComponentInstance[],
    lastSeenAt: null,
    worstStatus: null,
    details: null,
    ...over,
  };
}

afterEach(cleanup);

describe("network detail section (spec 065)", () => {
  it("renders the bounded allowlist in a named Network section", () => {
    const c = component({
      details: {
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
        ipam: { subnets: ["10.0.0.0/24"] }, // excluded — must not render
        options: { "com.docker.network.bridge.name": "docker0" },
      },
    });
    wrap(<ComponentDetail component={c} />);
    expect(screen.getByText("Network")).toBeTruthy();
    expect(screen.getByText("overlay")).toBeTruthy();
    expect(screen.getByText("swarm")).toBeTruthy();
    expect(screen.getByText("web-1")).toBeTruthy();
    expect(screen.getByText("api-1")).toBeTruthy();
    expect(screen.getByText("com.docker.compose.project")).toBeTruthy();
    expect(screen.getByText("myapp")).toBeTruthy();
    // excluded fields never render
    expect(screen.queryByText(/10\.0\.0\.0\/24/)).toBeNull();
    expect(screen.queryByText(/docker0/)).toBeNull();
    expect(screen.queryByText("ipam")).toBeNull();
    expect(screen.queryByText("options")).toBeNull();
  });

  it("omits unreported fields and renders nothing for foreign shapes", () => {
    const minimal = component({
      details: { driver: "bridge", scope: "local", attachedCount: 0 },
    });
    wrap(<ComponentDetail component={minimal} />);
    expect(screen.getByText("Network")).toBeTruthy();
    expect(screen.getByText("bridge")).toBeTruthy();
    expect(screen.queryByText("Ingress")).toBeNull();
    expect(screen.queryByText("IPv6")).toBeNull();

    cleanup();
    const foreign = component({
      details: { subnet: "10.1.0.0/16", gateway: "10.1.0.1", mountpoint: "/data" },
    });
    wrap(<ComponentDetail component={foreign} />);
    expect(screen.queryByText("Network")).toBeNull();
    expect(screen.queryByText(/10\.1\.0\.0\/16/)).toBeNull();
    expect(screen.queryByText("/data")).toBeNull();
  });
});

describe("volume detail section (spec 065)", () => {
  it("renders the bounded allowlist in a named Volume section", () => {
    const c = component({
      category: "STORAGE",
      resourceType: "volume",
      name: "pgdata",
      details: {
        driver: "local",
        scope: "local",
        createdAt: "2026-09-15T08:30:00Z",
        sizeBytes: 5242880,
        refCount: 2,
        reclaimable: true,
        labels: { "com.docker.compose.project": "shop" },
        mountpoint: "/var/lib/docker/volumes/pgdata/_data", // excluded
        options: { device: ":/srv/pg" }, // excluded
        status: { note: "x" }, // excluded
      },
    });
    wrap(<ComponentDetail component={c} />);
    expect(screen.getByText("Volume")).toBeTruthy();
    expect(screen.getAllByText("local").length).toBeGreaterThanOrEqual(2); // driver + scope
    expect(screen.getByText("5.0 MiB")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy(); // refCount
    expect(screen.getByText("com.docker.compose.project")).toBeTruthy();
    expect(screen.getByText("shop")).toBeTruthy();
    expect(screen.queryByText(/\/var\/lib\/docker\/volumes/)).toBeNull();
    expect(screen.queryByText(/:\/srv\/pg/)).toBeNull();
    expect(screen.queryByText("mountpoint")).toBeNull();
    expect(screen.queryByText("options")).toBeNull();
    expect(screen.queryByText("status")).toBeNull();
  });

  it("omits usage fields the engine did not report", () => {
    const c = component({
      category: "STORAGE",
      resourceType: "volume",
      name: "cache",
      details: { driver: "local", scope: "local", createdAt: "2026-01-01T00:00:00Z" },
    });
    wrap(<ComponentDetail component={c} />);
    expect(screen.getByText("Volume")).toBeTruthy();
    expect(screen.queryByText(/MiB|GiB|KiB/)).toBeNull();
    expect(screen.queryByText("Reclaimable")).toBeNull();
  });

  it("renders no Volume section for non-volume resource types", () => {
    const c = component({
      category: "CONTAINER",
      resourceType: "compose-service",
      details: { driver: "should-not-render", sizeBytes: 123 },
    });
    wrap(<ComponentDetail component={c} />);
    expect(screen.queryByText("Volume")).toBeNull();
    expect(screen.queryByText("should-not-render")).toBeNull();
  });
});
