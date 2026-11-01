import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import { ImporterForm } from "@/ux/components/importers/importer-form";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const createMutate = vi.fn();
vi.mock("@/api/hooks/importers", () => ({
  useCreateImporterConfig: () => ({ mutate: createMutate, isPending: false }),
  useUpdateImporterConfig: () => ({ mutate: vi.fn(), isPending: false }),
}));

const DOCKER = {
  name: "docker",
  label: "Docker",
  description: "Import Docker workloads",
  targetRefKey: "targetId",
  configSchema: {
    type: "object",
    required: ["targetId"],
    properties: {
      targetId: { type: "string", minLength: 1 },
      includeImages: { type: "boolean", default: false },
    },
  },
};

const TARGETS = [
  { id: "t1", targetId: "prod", label: "Prod engine", enabled: true, profile: { transport: "socket" } },
  { id: "t2", targetId: "old", label: "Retired engine", enabled: false, profile: { transport: "tcp" } },
];

const renderForm = (props: Record<string, unknown> = {}) =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <ImporterForm manifests={[DOCKER] as never} credentials={[]} agents={[]} dockerTargets={TARGETS as never} {...props} />
      </TooltipProvider>
    </MemoryRouter>,
  );

describe("ImporterForm — Docker Hub target picker (spec 049)", () => {
  afterEach(() => { cleanup(); createMutate.mockClear(); });

  it("shows a managed-target picker for Hub execution instead of free-text targetId", () => {
    renderForm();
    expect(document.getElementById("i-target")).toBeTruthy();
    // The schema's targetId field is replaced by the picker on Hub.
    expect(document.getElementById("i-scope-targetId")).toBeNull();
  });

  it("lists enabled targets; disabled targets stay hidden unless already selected", () => {
    renderForm();
    fireEvent.keyDown(document.getElementById("i-target")!, { key: "ArrowDown" });
    const items = Array.from(document.querySelectorAll('[data-slot="select-item"]'));
    const labels = items.map((i) => i.textContent);
    expect(labels.some((l) => l?.includes("Prod engine"))).toBe(true);
    expect(labels.some((l) => l?.includes("Retired engine"))).toBe(false);
  });

  it("keeps a disabled target visible but unselectable when it is the stored selection", () => {
    renderForm({ config: { id: "c1", importerName: "docker", label: "cfg", scope: { targetId: "old" }, credentialIds: [], agentId: null, schedule: null, enabled: true } });
    fireEvent.keyDown(document.getElementById("i-target")!, { key: "ArrowDown" });
    const disabled = Array.from(document.querySelectorAll('[data-slot="select-item"]'))
      .find((i) => i.textContent?.includes("disabled"));
    expect(disabled?.hasAttribute("data-disabled")).toBe(true);
  });

  it("requires a target selection on submit", () => {
    renderForm();
    fireEvent.change(document.getElementById("i-label")!, { target: { value: "cfg" } });
    fireEvent.click(screen.getByRole("button", { name: /create importer/i }));
    expect(createMutate).not.toHaveBeenCalled();
    expect(screen.getByText(/Docker target is required/i)).toBeTruthy();
  });
});
