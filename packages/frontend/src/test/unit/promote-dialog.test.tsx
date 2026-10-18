import { describe, it, expect, afterEach, vi } from "vitest";
import {
  render,
  cleanup,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { PromoteToPlatformDialog } from "@/components/products/promote-to-platform-dialog";
import { ComponentDetailPage } from "@/pages/component-detail";

type PromoteVars = {
  id: string;
  input: { consumerIds?: string[]; name?: string };
};
const promoteMutate = vi.fn<(vars: PromoteVars) => Promise<unknown>>();
promoteMutate.mockImplementation(async () => ({
  product: { slug: "payments-platform" },
  consumers: [],
}));
const mockNavigate = vi.fn();

const mockDependents = vi.fn();
const mockSession = vi.fn(() => ({ data: { role: "EDITOR" } }));
const mockDetail = vi.fn();

vi.mock("react-router-dom", async (importOriginal) => {
  const mod = await importOriginal<typeof import("react-router-dom")>();
  return { ...mod, useNavigate: () => mockNavigate };
});

vi.mock("@/api/hooks/auth", () => ({
  useSession: () => mockSession(),
}));

vi.mock("@/api/hooks/components", () => ({
  useComponentDependents: (id: string | null) => mockDependents(id),
  usePromoteComponent: () => ({
    mutateAsync: promoteMutate,
    isPending: false,
  }),
  useComponentDetail: (id: string | null) => mockDetail(id),
  useUpdateComponent: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/api/hooks/org", () => ({
  useLobs: () => ({ data: { lobs: [] } }),
  useTeams: () => ({ data: { teams: [] } }),
}));

// Heavy children of the detail page — stub so no QueryClient is needed.
vi.mock("@/components/entity-history", () => ({
  EntityHistory: () => null,
}));
vi.mock("@/components/metadata/component-metadata-form", () => ({
  ComponentMetadataForm: () => null,
}));

const component = {
  id: "comp-1",
  name: "payments-repo",
  slug: "payments-repo",
  category: "REPOSITORY",
  provider: "GITHUB",
  resourceType: "repo",
  lifecycle: "ACTIVE",
  componentGroupId: null,
  componentGroupName: null,
  teamOwnerId: null,
  teamOwnerName: null,
  links: [],
  tags: [],
  instanceCount: 0,
  externalId: null,
  details: null,
  lastSeenAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  instances: [],
};

const dependents = [
  { id: "p1", name: "Checkout", slug: "checkout", type: "CUSTOMER_FACING" },
  { id: "p2", name: "Orders", slug: "orders", type: "BUSINESS_CAPABILITY" },
];

function dependentsLoaded(list = dependents) {
  mockDependents.mockReturnValue({
    data: list,
    isPending: false,
    error: null,
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockSession.mockImplementation(() => ({ data: { role: "EDITOR" } }));
  promoteMutate.mockResolvedValue({
    product: { slug: "payments-platform" },
    consumers: [],
  });
});

function renderDialog() {
  return render(
    <MemoryRouter>
      <PromoteToPlatformDialog
        open
        onClose={() => {}}
        component={{ id: component.id, name: component.name }}
      />
    </MemoryRouter>,
  );
}

describe("PromoteToPlatformDialog", () => {
  it("pre-fills the name from the component; slug stays auto-derived", () => {
    dependentsLoaded();
    renderDialog();
    expect(
      (screen.getByLabelText(/name/i) as HTMLInputElement).value,
    ).toBe("payments-repo");
    expect(
      (screen.getByLabelText(/slug/i) as HTMLInputElement).value,
    ).toBe("");
  });

  it("checks every consumer by default and POSTs all consumerIds", async () => {
    dependentsLoaded();
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /^promote$/i }));
    await waitFor(() => expect(promoteMutate).toHaveBeenCalled());
    const vars = promoteMutate.mock.calls[0]![0];
    expect(vars.id).toBe("comp-1");
    expect(vars.input.consumerIds?.sort()).toEqual(["p1", "p2"]);
  });

  it("excludes unchecked consumers from consumerIds", async () => {
    dependentsLoaded();
    renderDialog();
    fireEvent.click(screen.getByRole("checkbox", { name: /orders/i }));
    fireEvent.click(screen.getByRole("button", { name: /^promote$/i }));
    await waitFor(() => expect(promoteMutate).toHaveBeenCalled());
    const vars = promoteMutate.mock.calls[0]![0];
    expect(vars.input.consumerIds).toEqual(["p1"]);
  });

  it("navigates to the new product on success", async () => {
    dependentsLoaded();
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /^promote$/i }));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("/products/payments-platform"),
    );
  });

  it("renders API errors via describeApiError", async () => {
    dependentsLoaded();
    promoteMutate.mockRejectedValue({
      code: "SLUG_TAKEN",
      message: 'Slug "taken" is already in use',
    });
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /^promote$/i }));
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain("already in use"),
    );
  });
});

describe("Component detail promote entry point (US3)", () => {
  function detailLoaded(over: Partial<typeof component> = {}) {
    mockDetail.mockReturnValue({
      data: { component: { ...component, ...over } },
      isPending: false,
      isFetching: false,
      error: null,
      refetch: vi.fn(),
    });
  }

  function renderPage() {
    return render(
      <MemoryRouter initialEntries={[`/components/${component.id}`]}>
        <Routes>
          <Route path="/components/:id" element={<ComponentDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("shows the Promote to platform button to EDITOR on an ACTIVE component", () => {
    detailLoaded();
    dependentsLoaded();
    renderPage();
    expect(
      screen.getByRole("button", { name: /promote to platform/i }),
    ).toBeDefined();
  });

  it("hides the button for VIEWER", () => {
    mockSession.mockImplementation(() => ({ data: { role: "VIEWER" } }));
    detailLoaded();
    renderPage();
    expect(
      screen.queryByRole("button", { name: /promote to platform/i }),
    ).toBeNull();
  });

  it("hides the button on a RETIRED component", () => {
    detailLoaded({ lifecycle: "RETIRED" });
    renderPage();
    expect(
      screen.queryByRole("button", { name: /promote to platform/i }),
    ).toBeNull();
  });

  it("opens the dialog with an empty checklist when the component has no dependents", async () => {
    detailLoaded();
    dependentsLoaded([]);
    renderPage();
    fireEvent.click(
      screen.getByRole("button", { name: /promote to platform/i }),
    );
    await waitFor(() =>
      expect(screen.getByText(/no products depend/i)).toBeDefined(),
    );
    fireEvent.click(screen.getByRole("button", { name: /^promote$/i }));
    await waitFor(() => expect(promoteMutate).toHaveBeenCalled());
    expect(promoteMutate.mock.calls[0]![0].input.consumerIds).toEqual([]);
  });
});
