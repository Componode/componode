import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import { ComponentDetail } from "@/ux/components/catalog/component-detail";
import type { Component, ComponentInstance } from "@/ux/lib/view-types";

// The edit dialog and URL-checks card need live query hooks — out of
// scope for this test.
vi.mock("@/ux/components/catalog/component-edit-dialog", () => ({
  ComponentEditDialog: () => null,
}));
vi.mock("@/ux/components/catalog/instance-environment-dialog", () => ({
  InstanceEnvironmentDialog: () => null,
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

function instance(rawConfig: ComponentInstance["rawConfig"]): ComponentInstance {
  return {
    id: "i1",
    environment: "PRODUCTION",
    reportedEnvironment: "PRODUCTION",
    environmentOverride: null,
    environmentOverriddenBy: null,
    environmentOverriddenAt: null,
    region: null,
    status: "ERROR",
    version: null,
    url: null,
    externalId: "docker-engine:e1::c1",
    lastSeenAt: "2026-11-01T00:00:00Z",
    rawConfig,
  };
}

function component(instances: ComponentInstance[]): Component {
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
    worstStatus: "ERROR",
    details: null,
  };
}

afterEach(cleanup);

describe("instance dockerObservation render (spec 047)", () => {
  it("expands to show allowlisted fields for an observed instance", () => {
    const c = component([
      instance({
        dockerObservation: {
          state: "running",
          oomKilled: true,
          startedAt: "2026-11-01T00:00:00Z",
          finishedAt: null,
          health: { status: "unhealthy", failingStreak: 3 },
        },
      }),
    ]);
    wrap(<ComponentDetail component={c} />);
    const toggle = screen.getByRole("button", { name: /show details/i });
    fireEvent.click(toggle);
    expect(screen.getByText("running")).toBeTruthy();
    expect(screen.getByText(/unhealthy/)).toBeTruthy();
    expect(screen.getByText("OOM killed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /hide details/i }));
    expect(screen.queryByText("OOM killed")).toBeNull();
  });

  it("renders an explicit no-healthcheck state when health is null", () => {
    const c = component([
      instance({ dockerObservation: { state: "exited", health: null } }),
    ]);
    wrap(<ComponentDetail component={c} />);
    fireEvent.click(screen.getByRole("button", { name: /show details/i }));
    expect(screen.getByText("No health check configured")).toBeTruthy();
    expect(screen.getByText("exited")).toBeTruthy();
  });

  it("shows no expand control for instances without an observation", () => {
    const c = component([instance(null), instance({ containerName: "x" })]);
    wrap(<ComponentDetail component={c} />);
    expect(screen.queryByRole("button", { name: /details/i })).toBeNull();
  });
});
