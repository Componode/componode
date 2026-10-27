import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import { ImporterForm } from "@/ux/components/importers/importer-form";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/api/hooks/importers", () => ({
  useCreateImporterConfig: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateImporterConfig: () => ({ mutate: vi.fn(), isPending: false }),
}));

const manifests = [
  {
    name: "github",
    label: "GitHub",
    description: "Import repositories",
    configSchema: {
      type: "object",
      required: ["org"],
      properties: { org: { type: "string" } },
    },
    secrets: [{ key: "token", label: "Token", required: true }],
  },
  {
    name: "kubernetes",
    label: "Kubernetes",
    description: "Import clusters",
    configSchema: { type: "object", properties: {} },
    secrets: [{ key: "kubeconfig", label: "Kubeconfig", required: true }],
  },
];

describe("ImporterForm — scope schema hint (F008, bugfix 036)", () => {
  afterEach(cleanup);

  const renderForm = () =>
    render(
      <MemoryRouter>
        <TooltipProvider>
          <ImporterForm manifests={manifests as never} credentials={[]} agents={[]} />
        </TooltipProvider>
      </MemoryRouter>,
    );

  it("shows the importer's required scope keys", () => {
    renderForm();
    expect(screen.getByText(/requires: org/i)).toBeTruthy();
  });

  it("prefills a scope JSON template with required keys", () => {
    renderForm();
    const scope = document.getElementById("i-scope") as HTMLTextAreaElement;
    expect(JSON.parse(scope.value)).toEqual({ org: "" });
  });

  it("switching importer type clears the previous importer's scope (F009)", async () => {
    renderForm();
    const scope = document.getElementById("i-scope") as HTMLTextAreaElement;
    expect(JSON.parse(scope.value)).toEqual({ org: "" });

    // Radix Select: open via keyboard on the combobox trigger, click the item.
    const trigger = screen.getAllByRole("combobox")[0]!;
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    const item = Array.from(document.querySelectorAll('[data-slot="select-item"]'))
      .find((el) => el.textContent === "Kubernetes")!;
    fireEvent.click(item);

    expect(JSON.parse(scope.value)).toEqual({});
  });
});
