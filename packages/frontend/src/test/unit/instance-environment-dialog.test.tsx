import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import { InstanceEnvironmentDialog } from "@/ux/components/catalog/instance-environment-dialog";
import type { ComponentInstance } from "@/ux/lib/view-types";

const updateMutate = vi.fn();
let sessionRole = "EDITOR";
vi.mock("@/api/hooks/components", () => ({
  useUpdateComponentInstanceEnvironment: () => ({ mutate: updateMutate, isPending: false }),
}));
vi.mock("@/api/hooks/auth", () => ({
  useSession: () => ({ data: { role: sessionRole }, isPending: false }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function instance(over: Partial<ComponentInstance> = {}): ComponentInstance {
  return {
    id: "i1",
    environment: "PRODUCTION",
    reportedEnvironment: "PRODUCTION",
    environmentOverride: null,
    environmentOverriddenBy: null,
    environmentOverriddenAt: null,
    region: null,
    status: "RUNNING",
    version: null,
    url: null,
    externalId: "ext-1",
    lastSeenAt: null,
    rawConfig: null,
    ...over,
  } as ComponentInstance;
}

describe("InstanceEnvironmentDialog (spec 071)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    sessionRole = "EDITOR";
  });

  const open = (inst: ComponentInstance) => {
    render(
      <TooltipProvider>
        <InstanceEnvironmentDialog instance={inst} />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByLabelText("Edit environment"));
  };

  it("shows the reported environment and disables save when nothing would change", () => {
    open(instance());
    expect(document.getElementById("ie-env")?.textContent).toContain("Production");
    const submit = document.querySelector('button[type="submit"]') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.queryByText("Reset to reported")).toBeNull();
    // Provenance copy explains the importer baseline.
    expect(document.body.textContent).toContain("Importer reports Production");
  });

  it("overridden instance shows provenance and offers reset", () => {
    open(
      instance({
        environment: "STAGING",
        environmentOverride: "STAGING",
        environmentOverriddenBy: "u1",
        environmentOverriddenAt: "2026-03-01T00:00:00Z",
      }),
    );
    expect(document.getElementById("ie-env")?.textContent).toContain("Staging");
    expect(document.body.textContent).toContain("Override active");
    expect(document.body.textContent).toContain("importer reports Production");
    expect(screen.getByText("Reset to reported")).toBeTruthy();
  });

  it("hides the edit affordance for VIEWER (advisory; API still enforces)", () => {
    sessionRole = "VIEWER";
    render(
      <TooltipProvider>
        <InstanceEnvironmentDialog instance={instance()} />
      </TooltipProvider>,
    );
    expect(screen.queryByLabelText("Edit environment")).toBeNull();
  });

  it("reset sends environment:null to clear the override", () => {
    open(
      instance({
        environment: "STAGING",
        reportedEnvironment: "PRODUCTION",
        environmentOverride: "STAGING",
      }),
    );
    fireEvent.click(screen.getByText("Reset to reported"));
    expect(updateMutate).toHaveBeenCalledWith(
      { id: "i1", environment: null },
      expect.anything(),
    );
  });
});
