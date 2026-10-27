import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, cleanup, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import { UxProductNewPage } from "@/ux/app/products/new";
import { UxComponentPromotePage } from "@/ux/app/components/$slug.promote";

const createMutate = vi.fn();
const updateMutate = vi.fn();
const promoteMutate = vi.fn();
const bootstrapMutateAsync = vi.fn();
const bootstrapMutate = vi.fn();

vi.mock("@/api/hooks/products", () => ({
  useCreateProduct: vi.fn(() => ({ mutate: createMutate, isPending: false })),
  useUpdateProduct: vi.fn(() => ({ mutate: updateMutate, isPending: false })),
  useBootstrapProducts: vi.fn(() => ({
    mutate: bootstrapMutate,
    mutateAsync: bootstrapMutateAsync,
    isPending: false,
  })),
}));
vi.mock("@/api/hooks/org", () => ({
  useLobs: vi.fn(),
  useTeams: vi.fn(),
}));
vi.mock("@/api/hooks/components", () => ({
  useComponents: vi.fn(),
  useComponentDetail: vi.fn(),
  useComponentDependents: vi.fn(),
  usePromoteComponent: vi.fn(() => ({ mutate: promoteMutate, isPending: false })),
}));

import { useLobs, useTeams } from "@/api/hooks/org";
import { useComponentDependents, useComponentDetail, useComponents } from "@/api/hooks/components";

const wrap = (el: React.ReactElement, entry = "/ux") =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <TooltipProvider>{el}</TooltipProvider>
    </MemoryRouter>,
  );

/** Renders inside a matching Route so useParams resolves. */
const wrapRoute = (path: string, el: React.ReactElement, entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <TooltipProvider>
        <Routes>
          <Route path={path} element={el} />
        </Routes>
      </TooltipProvider>
    </MemoryRouter>,
  );

const apiComponent = {
  id: "c1",
  name: "orders-db",
  slug: "orders-db",
  category: "DATABASE",
  provider: "AWS",
  resourceType: "rds:db",
  lifecycle: "ACTIVE",
  componentGroupId: null,
  componentGroupName: null,
  instanceCount: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useLobs).mockReturnValue({
    data: { lobs: [{ id: "l1", name: "Retail", slug: "retail", description: null, createdAt: "x", updatedAt: "x" }] },
    isPending: false,
    error: null,
  } as never);
  vi.mocked(useTeams).mockReturnValue({
    data: { teams: [{ id: "t1", name: "Payments", slug: "payments", description: null, createdAt: "x", updatedAt: "x" }] },
    isPending: false,
    error: null,
  } as never);
});

afterEach(cleanup);

describe("UxProductNewPage", () => {
  it("creates a product with a derived slug and null owner ids", () => {
    const { container } = wrap(<UxProductNewPage />, "/ux/products/new");
    const nameInput = container.querySelector("#p-name")!;
    fireEvent.change(nameInput, { target: { value: "Checkout" } });
    fireEvent.submit(container.querySelector("form")!);
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Checkout",
        slug: "checkout",
        lobOwnerId: null,
        teamOwnerId: null,
      }),
      expect.anything(),
    );
    // F006: lifecycle is edit-only — createProductSchema is .strict() and
    // rejects the key with 400 unrecognized_keys.
    expect(createMutate.mock.calls[0]![0]).not.toHaveProperty("lifecycle");
  });

  it("renders org options from the API, not fixtures", () => {
    wrap(<UxProductNewPage />, "/ux/products/new");
    expect(screen.getByText("Retail")).toBeTruthy();
    expect(screen.getByText("Payments")).toBeTruthy();
  });
});

describe("UxComponentPromotePage", () => {
  beforeEach(() => {
    vi.mocked(useComponents).mockReturnValue({
      data: { data: [apiComponent] },
      isPending: false,
      isSuccess: true,
      error: null,
    } as never);
    vi.mocked(useComponentDetail).mockReturnValue({
      data: { component: apiComponent },
      isPending: false,
      error: null,
    } as never);
    vi.mocked(useComponentDependents).mockReturnValue({
      data: [
        { id: "p1", name: "Checkout", slug: "checkout" },
        { id: "p2", name: "Billing", slug: "billing" },
      ],
      isPending: false,
      error: null,
    } as never);
  });

  it("lists real dependents as reroutable consumers", () => {
    wrapRoute("/ux/components/:slug/promote", <UxComponentPromotePage />, "/ux/components/orders-db/promote");
    expect(screen.getByText("Checkout")).toBeTruthy();
    expect(screen.getByText("Billing")).toBeTruthy();
  });

  it("submits PromoteToPlatformInput with checked consumer ids", () => {
    const { container } = wrapRoute("/ux/components/:slug/promote", <UxComponentPromotePage />, "/ux/components/orders-db/promote");
    fireEvent.submit(container.querySelector("form")!);
    expect(promoteMutate).toHaveBeenCalledWith(
      {
        id: "c1",
        input: expect.objectContaining({
          name: "orders-db",
          slug: "orders-db",
          consumerIds: ["p1", "p2"],
        }),
      },
      expect.anything(),
    );
  });

  it("excludes unchecked consumers from consumerIds", () => {
    const { container } = wrapRoute("/ux/components/:slug/promote", <UxComponentPromotePage />, "/ux/components/orders-db/promote");
    fireEvent.click(screen.getByLabelText(/Checkout/));
    fireEvent.submit(container.querySelector("form")!);
    expect(promoteMutate).toHaveBeenCalledWith(
      { id: "c1", input: expect.objectContaining({ consumerIds: ["p2"] }) },
      expect.anything(),
    );
  });
});

describe("UxProductImportPage", () => {
  it("runs a dry run and renders the report", async () => {
    bootstrapMutateAsync.mockResolvedValue({
      created: 3,
      updated: 1,
      edgesAdded: 6,
      skipped: [{ item: "legacy-billing", reason: "component not found" }],
    });
    const { UxProductImportPage } = await import("@/ux/app/products/import");
    const { container } = wrap(<UxProductImportPage />, "/ux/products/import");
    const input = container.querySelector<HTMLInputElement>("#catalog-file")!;
    const file = new File(["name: x"], "catalog.yaml", { type: "application/yaml" });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(screen.getByText(/Dry run for catalog\.yaml/)).toBeTruthy());
    expect(screen.getByText("legacy-billing")).toBeTruthy();
    expect(bootstrapMutateAsync).toHaveBeenCalledWith({ document: "name: x", dryRun: true });
  });
});
