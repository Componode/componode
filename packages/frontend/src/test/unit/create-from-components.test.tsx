import { describe, it, expect, afterEach, vi } from "vitest";
import {
  render,
  cleanup,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { ComponentsPage } from "@/pages/components";

const createMutate = vi.fn();
const mockNavigate = vi.fn();
const mockSession = vi.fn(() => ({ data: { role: "EDITOR" } }));

vi.mock("react-router-dom", async (importOriginal) => {
  const mod = await importOriginal<typeof import("react-router-dom")>();
  return { ...mod, useNavigate: () => mockNavigate };
});

vi.mock("@/api/hooks/auth", () => ({
  useSession: () => mockSession(),
}));

const mkComponent = (id: string, name: string, lifecycle = "ACTIVE") => ({
  id,
  name,
  slug: name,
  category: "DATABASE",
  provider: "AWS",
  resourceType: "rds",
  lifecycle,
  componentGroupId: null,
  componentGroupName: null,
  teamOwnerId: null,
  teamOwnerName: null,
  links: [],
  tags: [],
  instanceCount: 0,
  externalId: null,
  details: null,
  sunsetAt: null,
  lastSeenAt: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

const PAGE_DATA = {
  data: [
    mkComponent("c1", "db-1"),
    mkComponent("c2", "api-1"),
    mkComponent("c3", "old-db", "RETIRED"),
  ],
  pagination: { page: 1, pageSize: 50, total: 3, pageCount: 1, hasNext: false },
};

vi.mock("@/api/hooks/components", () => ({
  useComponents: () => ({
    data: PAGE_DATA,
    isPending: false,
    isFetching: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock("@/api/hooks/products", () => ({
  useCreateProduct: () => ({ mutateAsync: createMutate, isPending: false }),
  useUpdateProduct: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/api/hooks/org", () => ({
  useLobs: () => ({ data: { lobs: [] } }),
  useTeams: () => ({ data: { teams: [] } }),
}));

// Filter chrome isn't under test — keep it stubbed.
vi.mock("@/components/component-filters", () => ({
  ComponentFilters: () => null,
}));
vi.mock("@/components/component-search", () => ({
  ComponentSearch: () => null,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockSession.mockImplementation(() => ({ data: { role: "EDITOR" } }));
  createMutate.mockResolvedValue({ product: { slug: "wired-product" } });
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/components"]}>
      <Routes>
        <Route path="/components" element={<ComponentsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("create product from components (US2)", () => {
  it("renders row checkboxes for ACTIVE components only", () => {
    renderPage();
    expect(
      screen.getByRole("checkbox", { name: /select db-1/i }),
    ).toBeDefined();
    expect(
      screen.getByRole("checkbox", { name: /select api-1/i }),
    ).toBeDefined();
    expect(
      screen.queryByRole("checkbox", { name: /select old-db/i }),
    ).toBeNull();
  });

  it("shows the selection bar with a Create product action once rows are picked", () => {
    renderPage();
    expect(screen.queryByText(/selected/i)).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /select db-1/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /select api-1/i }));
    expect(screen.getByText(/2 selected/i)).toBeDefined();
    expect(
      screen.getByRole("button", { name: /create product/i }),
    ).toBeDefined();
  });

  it("hides selection controls entirely for VIEWER", () => {
    mockSession.mockImplementation(() => ({ data: { role: "VIEWER" } }));
    renderPage();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(
      screen.queryByRole("button", { name: /create product/i }),
    ).toBeNull();
  });

  it("opens ProductForm with the wiring notice and submits componentIds", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("checkbox", { name: /select db-1/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /select api-1/i }));
    fireEvent.click(screen.getByRole("button", { name: /create product/i }));

    expect(screen.getByText(/wired to 2 components/i)).toBeDefined();

    fireEvent.change(screen.getByLabelText(/name/i), {
      target: { value: "Wired Product" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(createMutate).toHaveBeenCalled());
    const vars = createMutate.mock.calls[0]![0];
    expect(vars.name).toBe("Wired Product");
    expect(vars.componentIds?.sort()).toEqual(["c1", "c2"]);
  });

  it("navigates to the new product and clears the selection on success", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("checkbox", { name: /select db-1/i }));
    fireEvent.click(screen.getByRole("button", { name: /create product/i }));
    fireEvent.change(screen.getByLabelText(/name/i), {
      target: { value: "Wired Product" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("/products/wired-product"),
    );
    await waitFor(() =>
      expect(screen.queryByText(/selected/i)).toBeNull(),
    );
  });
});
