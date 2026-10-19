import { describe, it, expect, afterEach, vi } from "vitest";
import {
  render,
  cleanup,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { ImportProductsDialog } from "@/components/products/import-products-dialog";

type Vars = { document: string; dryRun: boolean };
const bootstrapMutate = vi.fn<(vars: Vars) => Promise<unknown>>();

vi.mock("@/api/hooks/products", () => ({
  useBootstrapProducts: () => ({
    mutateAsync: bootstrapMutate,
    isPending: false,
  }),
}));

vi.mock("@/api/hooks/auth", () => ({
  useSession: () => ({ data: { role: "EDITOR" } }),
}));

const YAML_DOC = `version: 1
products:
  - name: Payments Shop
    type: CUSTOMER_FACING
    dependsOn: [payments-db]
`;

const PREVIEW = {
  created: 1,
  updated: 0,
  edgesAdded: 1,
  skipped: [{ item: "Payments Shop", reason: 'Owner "missing-lob" not found' }],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  bootstrapMutate.mockResolvedValue(PREVIEW);
});

function renderDialog() {
  return render(<ImportProductsDialog open onClose={() => {}} />);
}

function pickFile(content = YAML_DOC, name = "catalog.yaml") {
  const input = screen.getByLabelText(/catalog file/i) as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File([content], name, { type: "application/yaml" })] },
  });
}

describe("ImportProductsDialog", () => {
  it("runs a dry-run preview with the file text on selection", async () => {
    renderDialog();
    pickFile();
    await waitFor(() => expect(bootstrapMutate).toHaveBeenCalled());
    const vars = bootstrapMutate.mock.calls[0]![0];
    expect(vars.dryRun).toBe(true);
    expect(vars.document).toBe(YAML_DOC);
  });

  it("renders the preview report — counts and skipped entries", async () => {
    renderDialog();
    pickFile();
    await waitFor(() =>
      expect(screen.getByText(/1 created/i)).toBeDefined(),
    );
    expect(screen.getByText(/1 edge/i)).toBeDefined();
    expect(screen.getByText(/Payments Shop/)).toBeDefined();
    expect(screen.getByText(/missing-lob/)).toBeDefined();
  });

  it("Apply sends the real import and renders the final report", async () => {
    renderDialog();
    pickFile();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /^apply$/i })).toBeDefined(),
    );
    bootstrapMutate.mockResolvedValue({ ...PREVIEW, skipped: [] });
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));
    await waitFor(() => expect(bootstrapMutate).toHaveBeenCalledTimes(2));
    expect(bootstrapMutate.mock.calls[1]![0].dryRun).toBe(false);
    await waitFor(() =>
      expect(screen.getByText(/import complete/i)).toBeDefined(),
    );
  });

  it("surfaces VALIDATION_FAILED via describeApiError", async () => {
    bootstrapMutate.mockRejectedValue({
      code: "VALIDATION_FAILED",
      message: "products.0.type: Invalid enum value",
    });
    renderDialog();
    pickFile();
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Invalid enum value",
      ),
    );
  });
});
