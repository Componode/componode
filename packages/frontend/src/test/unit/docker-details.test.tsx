import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import { ComponentDetail } from "@/ux/components/catalog/component-detail";
import type { Component, ComponentInstance } from "@/ux/lib/view-types";

// spec 064 US5 — bounded allowlist rendering: named sections only, no
// generic rawConfig/details dump.
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

function instance(
  rawConfig: ComponentInstance["rawConfig"],
  over: Partial<ComponentInstance> = {},
): ComponentInstance {
  return {
    id: "i1",
    environment: "PRODUCTION",
    region: null,
    status: "RUNNING",
    version: null,
    url: null,
    externalId: "docker-engine:e1::c1",
    lastSeenAt: "2026-11-01T00:00:00Z",
    rawConfig,
    ...over,
  };
}

function component(
  instances: ComponentInstance[],
  over: Partial<Component> = {},
): Component {
  return {
    id: "c1",
    name: "web",
    slug: "web",
    category: "CONTAINER",
    provider: "DOCKER",
    resourceType: "compose-service",
    lifecycle: "ACTIVE",
    componentGroups: [],
    teamOwnerId: null,
    teamOwnerName: null,
    tags: [],
    sunsetAt: null,
    links: [],
    instanceCount: instances.length,
    instances,
    lastSeenAt: null,
    worstStatus: "RUNNING",
    details: null,
    ...over,
  };
}

const expand = () =>
  fireEvent.click(screen.getByRole("button", { name: /show details/i }));

afterEach(cleanup);

describe("enriched instance sections (spec 064)", () => {
  it("renders hostConfig, healthcheck, and networks sections for a container", () => {
    const c = component([
      instance({
        dockerObservation: { state: "running", health: null },
        imageId: "sha256:abc",
        hostConfig: {
          memoryBytes: 536870912,
          nanoCpus: 1500000000,
          pidsLimit: 512,
          restartPolicy: { mode: "unless-stopped", maxRetries: 5 },
          privileged: true,
          readOnlyRootfs: true,
          logDriver: "json-file",
        },
        healthcheck: {
          intervalSeconds: 30,
          timeoutSeconds: 10,
          retries: 3,
          startPeriodSeconds: 5,
        },
        networks: ["commerce_default"],
        unknownDump: { secret: "never-render" },
      }),
    ]);
    wrap(<ComponentDetail component={c} />);
    expand();
    expect(screen.getByText("Host config")).toBeTruthy();
    expect(screen.getByText("Health check definition")).toBeTruthy();
    expect(screen.getByText("Networks")).toBeTruthy();
    expect(screen.getByText("commerce_default")).toBeTruthy();
    expect(screen.getByText("512 MiB")).toBeTruthy(); // memoryBytes formatted
    expect(screen.getByText("1.5 CPUs")).toBeTruthy(); // nanoCpus → CPUs
    expect(screen.getByText(/unless-stopped/)).toBeTruthy();
    expect(screen.getByText("json-file")).toBeTruthy();
    expect(screen.getByText("30s")).toBeTruthy(); // intervalSeconds
    // allowlist only — unknown keys never render
    expect(screen.queryByText(/never-render/)).toBeNull();
    expect(screen.queryByText("unknownDump")).toBeNull();
  });

  it("expands for a swarm service with no dockerObservation and renders ports/networks/mode", () => {
    const c = component(
      [
        instance({
          swarmObservation: {
            mode: "replicated-job",
            desired: 1,
            running: 1,
            completed: 0,
            updateState: "completed",
            observedAt: "2026-11-01T00:00:00Z",
          },
          ports: [
            { protocol: "tcp", target: 80, published: 8080, publishMode: "ingress" },
          ],
          networks: ["frontend", "backend"],
        }),
      ],
      { category: "CONTAINER_ORCHESTRATION", resourceType: "swarm-service" },
    );
    wrap(<ComponentDetail component={c} />);
    expand();
    expect(screen.getByText("replicated-job")).toBeTruthy();
    expect(screen.getByText("frontend")).toBeTruthy();
    expect(screen.getByText("backend")).toBeTruthy();
    expect(screen.getByText(/8080/)).toBeTruthy(); // published port
  });

  it("does not render a Ports section for container-shaped ports", () => {
    const c = component([
      instance({
        dockerObservation: { state: "running", health: null },
        ports: [{ container: "80/tcp", published: [{ hostIp: "0.0.0.0", hostPort: "8080" }] }],
      }),
    ]);
    wrap(<ComponentDetail component={c} />);
    expand();
    // container ports are a different (pre-existing) shape — the swarm
    // ports section must not misrender them
    expect(screen.queryByText("Ports")).toBeNull();
  });

  it("renders the deployed image identity in a named Image section", () => {
    const c = component([
      instance({
        imageRef: "registry.local/app:1.2.3",
        imageDigest: "registry.local/app@sha256:deadbeef",
        imageId: "sha256:img1",
      }),
    ]);
    wrap(<ComponentDetail component={c} />);
    expand();
    expect(screen.getByText("Image")).toBeTruthy();
    expect(screen.getByText("registry.local/app:1.2.3")).toBeTruthy();
    expect(screen.getByText("registry.local/app@sha256:deadbeef")).toBeTruthy();
    expect(screen.getByText("sha256:img1")).toBeTruthy();
  });

  it("expands when only networks is present (legacy rawConfig, spec 064 converge)", () => {
    const c = component([instance({ networks: ["legacy_net"] })]);
    wrap(<ComponentDetail component={c} />);
    expand();
    expect(screen.getByText("Networks")).toBeTruthy();
    expect(screen.getByText("legacy_net")).toBeTruthy();
  });

  it("shows no expand control when only unknown rawConfig keys exist", () => {
    const c = component([instance({ containerName: "x", mystery: { a: 1 } })]);
    wrap(<ComponentDetail component={c} />);
    expect(screen.queryByRole("button", { name: /details/i })).toBeNull();
  });
});

describe("engine + image detail sections (spec 064)", () => {
  it("renders the Engine section for a docker-engine component", () => {
    const c = component([], {
      category: "COMPUTE",
      resourceType: "docker-engine",
      name: "prod-docker",
      details: {
        serverVersion: "27.3.1",
        apiVersion: "1.45",
        os: "linux",
        arch: "x86_64",
        kernelVersion: "6.8.0-51-generic",
        cgroupDriver: "systemd",
        runtimes: ["io.containerd.runc.v2", "runc"],
        registryMirrors: ["https://mirror.example.com"],
        swarmNodeState: "active",
        swarmControlAvailable: true,
        swarmManagers: 3,
        DockerRootDir: "/var/lib/docker", // excluded field — must not render
      },
    });
    wrap(<ComponentDetail component={c} />);
    expect(screen.getByText("Engine")).toBeTruthy();
    expect(screen.getByText("27.3.1")).toBeTruthy();
    expect(screen.getByText("1.45")).toBeTruthy();
    expect(screen.getByText("systemd")).toBeTruthy();
    expect(screen.getByText(/io\.containerd\.runc\.v2/)).toBeTruthy();
    expect(screen.getByText("https://mirror.example.com")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy(); // swarmManagers
    expect(screen.queryByText(/DockerRootDir/)).toBeNull();
    expect(screen.queryByText("/var/lib/docker")).toBeNull();
  });

  it("renders the Image provenance section for an image component", () => {
    const c = component([], {
      category: "PACKAGE_REGISTRY",
      resourceType: "image",
      name: "app:latest",
      details: {
        imageId: "sha256:img1",
        size: 104857600,
        created: 123,
        architecture: "amd64",
        os: "linux",
        user: "node",
        entrypoint: ["node", "server.js"],
        workingDir: "/app",
        exposedPorts: ["8080/tcp", "443/tcp"],
        volumes: ["/data"],
        ociLabels: {
          "org.opencontainers.image.source": "https://github.com/org/repo",
          "org.opencontainers.image.version": "1.2.3",
        },
        Env: ["SECRET=hunter2"], // excluded — must not render
      },
    });
    wrap(<ComponentDetail component={c} />);
    expect(screen.getByText("Image provenance")).toBeTruthy();
    expect(screen.getByText("amd64")).toBeTruthy();
    expect(screen.getByText("node")).toBeTruthy();
    expect(screen.getByText("/app")).toBeTruthy();
    expect(screen.getByText("8080/tcp")).toBeTruthy();
    expect(screen.getByText("/data")).toBeTruthy();
    expect(screen.getByText("https://github.com/org/repo")).toBeTruthy();
    expect(screen.getByText("1.2.3")).toBeTruthy();
    expect(screen.queryByText(/hunter2/)).toBeNull();
    expect(screen.queryByText("Env")).toBeNull();
  });

  it("renders no engine/image sections for other resource types", () => {
    const c = component([], {
      resourceType: "compose-service",
      details: { serverVersion: "should-not-render", ociLabels: { x: "y" } },
    });
    wrap(<ComponentDetail component={c} />);
    expect(screen.queryByText("Engine")).toBeNull();
    expect(screen.queryByText("Image provenance")).toBeNull();
    expect(screen.queryByText("should-not-render")).toBeNull();
  });
});
