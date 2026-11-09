import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import { SidebarProvider } from "@/ux/components/ui/sidebar";
import type { Product, ProductTopology } from "@/ux/lib/view-types";

const suggestionsQuery = vi.fn();
const acceptSuggestionMutation = vi.fn();
const agentsQuery = vi.fn();
const globalSearchQuery = vi.fn();
const updateProductMutation = vi.fn();
const deleteProductMutation = vi.fn();
const logoutMutation = vi.fn();
const setTheme = vi.fn();
const setCommandOpen = vi.fn();
let sessionRole = "ADMIN";

vi.mock("@/api/hooks/products", () => ({
  useUpdateProduct: () => ({ mutate: updateProductMutation, isPending: false }),
  useDeleteProduct: () => ({ mutate: deleteProductMutation, isPending: false }),
}));
vi.mock("@/api/hooks/suggestions", () => ({
  useSuggestions: (...args: unknown[]) => suggestionsQuery(...args),
  useAcceptSuggestion: () => ({ mutate: acceptSuggestionMutation, isPending: false }),
}));
vi.mock("@/api/hooks/agents", () => ({
  useAgents: (...args: unknown[]) => agentsQuery(...args),
  // The sidebar badge fetches the full set via the fetch-all variant
  // (spec 068) — same spy keeps the call assertions working.
  useAllAgents: (...args: unknown[]) => agentsQuery(...args),
}));
vi.mock("@/api/hooks/auth", () => ({
  useLogout: () => ({ mutate: logoutMutation, isPending: false }),
}));
vi.mock("@/api/hooks/search", () => ({
  useGlobalSearch: (...args: unknown[]) => globalSearchQuery(...args),
}));
vi.mock("@/ux/components/app/session-context", () => ({
  useSession: () => ({
    user: {
      id: "u1",
      username: "admin",
      displayName: "Admin User",
      email: "admin@example.test",
      role: sessionRole,
      isActive: true,
      lastActiveAt: null,
      createdAt: "2026-01-01T00:00:00Z",
    },
  }),
}));
vi.mock("@/ux/components/app/command-menu", () => ({
  useCommandMenu: () => ({ setOpen: setCommandOpen }),
}));
vi.mock("next-themes", () => ({
  useTheme: () => ({ resolvedTheme: "light", setTheme }),
}));

import { AppHeader } from "@/ux/components/app/app-header";
import { AppSidebar } from "@/ux/components/app/app-sidebar";
import { ProductDetail } from "@/ux/components/products/product-detail";

const product: Product = {
  id: "p1",
  name: "Topo Hub",
  slug: "topo-hub",
  type: "PLATFORM",
  lifecycle: "ACTIVE",
  status: "RUNNING",
  criticality: "HIGH",
  description: null,
  lobOwnerName: null,
  teamOwnerName: null,
  tags: [],
  links: [],
  sunsetAt: null,
  componentCount: 0,
  completeness: { owner: true, description: true, dependencies: true },
  updatedAt: "2026-01-01T00:00:00Z",
};

const topology: ProductTopology = {
  composedBy: [],
  composes: [],
  consumesFrom: [],
  consumedBy: [],
  dependsOnGroups: [],
  dependsOnComponents: [],
  unavailableGroups: [],
};

const wrap = (children: ReactNode, entry = "/") =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <TooltipProvider>{children}</TooltipProvider>
    </MemoryRouter>,
  );

beforeEach(() => {
  sessionRole = "ADMIN";
  suggestionsQuery.mockReturnValue({ data: { items: [], total: 7 }, isPending: false });
  agentsQuery.mockReturnValue({
    // useAllAgents resolves to the row array directly (spec 068).
    data: [
      { id: "a1", status: "CONNECTED" },
      { id: "a2", status: "OFFLINE" },
      { id: "a3", status: "NEVER_CONNECTED" },
    ],
    isPending: false,
  });
  globalSearchQuery.mockReturnValue({ data: {}, isPending: false });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("prototype shell parity (spec 062)", () => {
  it("scopes .ux-root on body so portal-rendered chrome inherits the visual baseline", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain('<body class="ux-root">');
  });

  it("renders real Help/docs and Notifications header destinations", () => {
    wrap(
      <SidebarProvider>
        <AppHeader />
      </SidebarProvider>,
      "/products/topo-hub",
    );

    const docs = screen.getByRole("link", { name: "Help & docs" });
    expect(docs.getAttribute("href")).toBe("https://componode.github.io/componode/");
    expect(docs.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByRole("link", { name: "Notifications" }).getAttribute("href")).toBe(
      "/settings/notifications",
    );
  });

  it("renders live pending-suggestion and attention-agent counts as nav pills", () => {
    wrap(
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>,
    );

    expect(screen.getByRole("link", { name: /Suggestions/ })).toBeTruthy();
    expect(screen.getByText("7")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Import agents/ })).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(agentsQuery).toHaveBeenCalledWith({ refetchInterval: false });
  });

  it("omits nav pills while cue data is loading or resolves to zero", () => {
    suggestionsQuery.mockReturnValue({ data: undefined, isPending: true });
    agentsQuery.mockReturnValue({ data: undefined, isPending: true });
    wrap(
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>,
    );
    expect(document.querySelectorAll('[data-sidebar="menu-badge"]')).toHaveLength(0);

    cleanup();
    suggestionsQuery.mockReturnValue({ data: { items: [], total: 0 }, isPending: false });
    agentsQuery.mockReturnValue({ data: [{ id: "a1", status: "CONNECTED" }], isPending: false });
    wrap(
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>,
    );
    expect(document.querySelectorAll('[data-sidebar="menu-badge"]')).toHaveLength(0);
  });

  it("does not render or query the ADMIN-only agent attention cue for a viewer", () => {
    sessionRole = "VIEWER";
    wrap(
      <SidebarProvider>
        <AppSidebar />
      </SidebarProvider>,
    );

    expect(screen.queryByRole("link", { name: /Import agents/ })).toBeNull();
    expect(agentsQuery).not.toHaveBeenCalled();
  });
});

describe("Product detail map parity (spec 062)", () => {
  it("resolves ?tab=map to a dedicated Map tab and keeps topology out of Dependencies", () => {
    wrap(
      <ProductDetail
        product={product}
        components={[]}
        consumers={[]}
        parents={[]}
        topology={topology}
        suggestions={[]}
        activity={[]}
      />,
      "/products/topo-hub?tab=map",
    );

    expect(screen.getByRole("tab", { name: "Map" }).getAttribute("data-state")).toBe("active");
    expect(screen.getByText("Product topology")).toBeTruthy();
    expect(screen.queryByText("Suggested edges")).toBeNull();

    cleanup();

    wrap(
      <ProductDetail
        product={product}
        components={[]}
        consumers={[]}
        parents={[]}
        topology={topology}
        suggestions={[]}
        activity={[]}
      />,
      "/products/topo-hub?tab=dependencies",
    );
    expect(screen.getByRole("tab", { name: "Dependencies" }).getAttribute("data-state")).toBe("active");
    expect(screen.queryByText("Product topology")).toBeNull();
    expect(screen.getByText("Suggested edges")).toBeTruthy();
  });

  it("lists incoming COMPOSES parents on Dependencies alongside consumers", () => {
    wrap(
      <ProductDetail
        product={product}
        components={[]}
        consumers={[]}
        parents={[{ id: "p-parent", name: "Parent Suite", slug: "parent-suite" }]}
        topology={topology}
        suggestions={[]}
        activity={[]}
      />,
      "/products/topo-hub?tab=dependencies",
    );
    expect(screen.getByText("Composed by")).toBeTruthy();
    const link = screen.getByRole("link", { name: "Parent Suite" });
    expect(link.getAttribute("href")).toContain("/products/parent-suite");
  });
});
