import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import { ComponentEditDialog } from "@/ux/components/catalog/component-edit-dialog";

const updateMutate = vi.fn();
vi.mock("@/api/hooks/components", () => ({
  useUpdateComponent: () => ({ mutate: updateMutate, isPending: false }),
}));
vi.mock("@/api/hooks/component-groups", () => ({
  useAllComponentGroups: () => ({ data: [{ id: "g1", name: "Core" }] }),
}));
vi.mock("@/api/hooks/org", () => ({
  useTeams: () => ({ data: { teams: [{ id: "t1", name: "Payments" }] } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const component = {
  id: "c1",
  name: "checkout-api",
  slug: "checkout-api",
  category: "SERVICE",
  provider: "GITHUB",
  resourceType: "repository",
  lifecycle: "ACTIVE",
  componentGroupId: "g1",
  componentGroupName: "Core",
  teamOwnerId: "t1",
  teamOwnerName: "Payments",
  tags: ["prod"],
  links: [],
  sunsetAt: "2027-01-15T00:00:00Z",
  instanceCount: 0,
  instances: [],
  lastSeenAt: null,
} as never;

describe("ComponentEditDialog (F012, bugfix 036)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const open = () => {
    const utils = render(
      <MemoryRouter>
        <TooltipProvider>
          <ComponentEditDialog component={component} trigger={<button type="button">Edit</button>} />
        </TooltipProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Edit"));
    return utils;
  };

  it("submits only schema-accepted keys with the component id", () => {
    open();
    // The dialog renders in a portal — query document, not the render container.
    fireEvent.submit(document.querySelector("form")!);
    expect(updateMutate).toHaveBeenCalledWith(
      {
        id: "c1",
        teamOwnerId: "t1",
        componentGroupId: "g1",
        tags: ["prod"],
        links: [],
        sunsetAt: "2027-01-15T00:00:00.000Z",
      },
      expect.anything(),
    );
  });

  it("prefills the current owner, group, tags and sunset", () => {
    open();
    expect((document.getElementById("ce-sunset") as HTMLInputElement).value).toBe("2027-01-15");
    expect(document.getElementById("ce-team")?.textContent).toContain("Payments");
    expect(document.getElementById("ce-group")?.textContent).toContain("Core");
  });
});

describe("compose tag suggestions (spec 047)", () => {
  afterEach(cleanup);
  const openFor = (over: Record<string, unknown>) => {
    render(
      <MemoryRouter>
        <TooltipProvider>
          <ComponentEditDialog
            component={{ ...(component as Record<string, unknown>), ...over } as never}
            trigger={<button type="button">Edit</button>}
          />
        </TooltipProvider>
      </MemoryRouter>,
    );
    fireEvent.click(screen.getAllByText("Edit")[0]!);
  };

  it("offers compose: and project-qualified service: chips; accept appends on save", () => {
    openFor({ provider: "DOCKER", details: { composeProject: "commerce", composeService: "web" }, tags: ["prod"] });
    const box = screen.getByTestId("tag-suggestions");
    expect(box.textContent).toContain("compose:commerce");
    expect(box.textContent).toContain("service:commerce.web");
    fireEvent.click([...box.querySelectorAll("button")].find((b) => b.textContent?.includes("service:commerce.web"))!);
    fireEvent.submit(document.querySelector("form")!);
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ["prod", "service:commerce.web"] }),
      expect.anything(),
    );
    // Nothing was written before the form save — mutate only fires once, on submit.
    expect(updateMutate).toHaveBeenCalledTimes(1);
  });

  it("omits invalid/overlong values and already-present tags", () => {
    openFor({
      provider: "DOCKER",
      details: { composeProject: "Bad Project!", composeService: "s" },
      tags: ["compose:bad project!"],
    });
    expect(screen.queryByTestId("tag-suggestions")).toBeNull();
    cleanup();
    openFor({
      provider: "DOCKER",
      details: { composeProject: "p".repeat(40), composeService: "s" },
      tags: [],
    });
    expect(screen.queryByTestId("tag-suggestions")).toBeNull();
    cleanup();
    // Grammar-invalid un-transformed (uppercase) — silently omitted, never normalized to fit.
    openFor({ provider: "DOCKER", details: { composeProject: "Commerce", composeService: "web" }, tags: [] });
    expect(screen.queryByTestId("tag-suggestions")).toBeNull();
    cleanup();
    openFor({ provider: "DOCKER", details: { composeProject: "commerce", composeService: "web" }, tags: ["compose:commerce", "service:commerce.web"] });
    expect(screen.queryByTestId("tag-suggestions")).toBeNull();
  });

  it("shows nothing for components without compose details or non-Docker providers", () => {
    openFor({ provider: "DOCKER", details: null });
    expect(screen.queryByTestId("tag-suggestions")).toBeNull();
    cleanup();
    // Non-Docker component carrying no Docker compose metadata — no suggestions.
    openFor({ provider: "GITHUB", details: { composeProject: "commerce", composeService: "web" } });
    expect(screen.queryByTestId("tag-suggestions")).toBeNull();
  });
});
