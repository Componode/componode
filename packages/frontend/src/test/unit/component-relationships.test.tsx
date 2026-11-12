import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import { ComponentRelationships } from "@/ux/components/catalog/component-relationships";
import type {
  ComponentRelationshipsView,
  RelatedComponentNode,
} from "@/ux/lib/view-types";

const focused: RelatedComponentNode = {
  id: "c-focus",
  name: "Payments API",
  slug: "payments-api",
  category: "WEB_ENDPOINT",
  provider: "GITHUB",
  resourceType: "web:endpoint",
  lifecycle: "ACTIVE",
};

const rel = (
  slug: string,
  over: Partial<RelatedComponentNode> = {},
): RelatedComponentNode => ({
  id: `id-${slug}`,
  name: slug,
  slug,
  category: "REPOSITORY",
  provider: "GITHUB",
  resourceType: "repo",
  lifecycle: "ACTIVE",
  ...over,
});

const product = (slug: string, over: Record<string, unknown> = {}) => ({
  id: `p-${slug}`,
  name: slug,
  slug,
  type: "BUSINESS_CAPABILITY" as const,
  lifecycle: "ACTIVE" as const,
  ...over,
});

const fullView: ComponentRelationshipsView = {
  component: focused,
  dependsOn: [rel("dep-target")],
  dependedOnBy: [rel("dep-source")],
  sourcesFrom: [rel("source-repo")],
  sourcedBy: [rel("source-consumer")],
  exposes: [rel("exposed-api")],
  exposedBy: [rel("api-consumer")],
  productDependents: {
    direct: [product("direct-product")],
    viaGroups: [
      {
        ...product("via-product"),
        viaGroup: {
          id: "g1",
          name: "Checkout services",
          slug: "checkout-services",
          lifecycle: "ACTIVE" as const,
        },
      },
    ],
  },
  instances: [
    {
      id: "i-prod",
      environment: "PRODUCTION",
      reportedEnvironment: "PRODUCTION",
      environmentOverride: null,
      environmentOverriddenBy: null,
      environmentOverriddenAt: null,
      region: "us-east-1",
      status: "RUNNING",
      version: "1.2.3",
      url: "https://api.example.com",
      externalId: "prod",
      lastSeenAt: "2026-01-01T00:00:00Z",
      rawConfig: null,
    },
    {
      id: "i-dev",
      environment: "DEV",
      reportedEnvironment: "DEV",
      environmentOverride: null,
      environmentOverriddenBy: null,
      environmentOverriddenAt: null,
      region: null,
      status: "STOPPED",
      version: null,
      url: null,
      externalId: "dev",
      lastSeenAt: null,
      rawConfig: null,
    },
  ],
  unavailableKinds: [],
};

const emptyView: ComponentRelationshipsView = {
  component: focused,
  dependsOn: [],
  dependedOnBy: [],
  sourcesFrom: [],
  sourcedBy: [],
  exposes: [],
  exposedBy: [],
  productDependents: { direct: [], viaGroups: [] },
  instances: [],
  unavailableKinds: [],
};

const renderView = (view: ComponentRelationshipsView = fullView) =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <ComponentRelationships view={view} />
      </TooltipProvider>
    </MemoryRouter>,
  );

afterEach(cleanup);

describe("ComponentRelationships view (spec 060)", () => {
  it("renders every typed lane with its direction label", () => {
    renderView();
    for (const label of [
      "Depended on by",
      "Sourced by",
      "Exposed by",
      "Product dependents",
      "Depends on",
      "Sources from",
      "Exposes",
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText("dep-target")).toBeTruthy();
    expect(screen.getByText("dep-source")).toBeTruthy();
    expect(screen.getByText("source-repo")).toBeTruthy();
    expect(screen.getByText("exposed-api")).toBeTruthy();
  });

  it("encodes actual relation direction in accessible node names", () => {
    renderView();
    // dependedOnBy: the source depends on the focused component.
    expect(
      screen.getByRole("button", { name: /dep-source.*depends on Payments API/i }),
    ).toBeTruthy();
    // dependsOn: the target is depended on by the focused component.
    expect(
      screen.getByRole("button", { name: /dep-target.*depended on by Payments API/i }),
    ).toBeTruthy();
    // sourcesFrom: focused sources from the repository.
    expect(
      screen.getByRole("button", { name: /source-repo.*sourced by Payments API/i }),
    ).toBeTruthy();
    // exposedBy: the consumer exposes the focused API.
    expect(
      screen.getByRole("button", { name: /api-consumer.*exposes Payments API/i }),
    ).toBeTruthy();
  });

  it("attributes group-mediated Products via their ComponentGroup", () => {
    renderView();
    expect(screen.getByText("direct-product")).toBeTruthy();
    expect(screen.getByText("via-product")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: /via-product.*via Checkout services/i,
      }),
    ).toBeTruthy();
    // The group path must never read as a direct Component edge.
    expect(screen.getByText(/via Checkout services/i)).toBeTruthy();
  });

  it("renders one node for a product on both paths with labeled provenance", () => {
    const dual = product("dual-product");
    renderView({
      ...fullView,
      productDependents: {
        direct: [dual],
        viaGroups: [
          {
            ...dual,
            viaGroup: {
              id: "g1",
              name: "Checkout services",
              slug: "checkout-services",
              lifecycle: "ACTIVE" as const,
            },
          },
        ],
      },
    });
    // Exactly one node — both provenance paths labeled on it.
    const nodes = screen.getAllByRole("button", { name: /dual-product/i });
    expect(nodes).toHaveLength(1);
    expect(nodes[0]!.getAttribute("aria-label")).toMatch(
      /depends on Payments API directly and via Checkout services/i,
    );
    expect(screen.getByText(/via Checkout services/i)).toBeTruthy();
    // Inspection lists both paths.
    fireEvent.click(nodes[0]!);
    expect(screen.getByText("Direct")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "Checkout services" }).getAttribute("href"),
    ).toContain("/component-groups/checkout-services");
  });

  it("nests ComponentInstances under the focused component with status", () => {
    renderView();
    // Instances are nested children, not peer lane nodes.
    expect(screen.getByText("Instances")).toBeTruthy();
    expect(screen.getByText("Production")).toBeTruthy();
    // Status labels also appear in the map legend — assert at least one each.
    expect(screen.getAllByText("Running").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Development")).toBeTruthy();
    expect(screen.getAllByText("Stopped").length).toBeGreaterThanOrEqual(1);
    // Instance names never appear as lane nodes.
    expect(screen.queryByRole("button", { name: /i-prod/ })).toBeNull();
  });

  it("labels retired related endpoints instead of dropping them", () => {
    renderView({
      ...fullView,
      dependsOn: [rel("old-target", { lifecycle: "RETIRED" })],
    });
    expect(screen.getByText("old-target")).toBeTruthy();
    expect(screen.getByText("Retired")).toBeTruthy();
  });

  it("caps lanes at four nodes with local +N expansion", () => {
    const many = Array.from({ length: 6 }, (_, i) => rel(`dep-${i}`));
    renderView({ ...fullView, dependsOn: many });
    expect(screen.getByText("dep-0")).toBeTruthy();
    expect(screen.getByText("dep-3")).toBeTruthy();
    expect(screen.queryByText("dep-4")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /\+2 more/i }));
    expect(screen.getByText("dep-4")).toBeTruthy();
    expect(screen.getByText("dep-5")).toBeTruthy();
    // Other lanes are unaffected.
    expect(screen.getByText("dep-source")).toBeTruthy();
  });

  it("selecting a node opens its inspection details and entity link", () => {
    renderView();
    fireEvent.click(
      screen.getByRole("button", { name: /dep-source.*depends on Payments API/i }),
    );
    const open = screen.getByRole("link", { name: /open component/i });
    expect(open.getAttribute("href")).toContain("/components/dep-source");
  });

  it("selecting a group-mediated product links the product and shows the group", () => {
    renderView();
    fireEvent.click(
      screen.getByRole("button", { name: /via-product.*via Checkout services/i }),
    );
    const open = screen.getByRole("link", { name: /open product/i });
    expect(open.getAttribute("href")).toContain("/products/via-product");
    expect(
      screen.getByRole("link", { name: "Checkout services" }).getAttribute("href"),
    ).toContain("/component-groups/checkout-services");
  });

  it("activates nodes with Enter or Space and clears with Escape", () => {
    renderView();
    const node = screen.getByRole("button", {
      name: /dep-target.*depended on by Payments API/i,
    });
    fireEvent.keyDown(node, { key: "Enter" });
    expect(screen.getByRole("link", { name: /open component/i })).toBeTruthy();
    fireEvent.keyDown(node, { key: "Escape" });
    expect(screen.queryByRole("link", { name: /open component/i })).toBeNull();
    fireEvent.keyDown(node, { key: " " });
    expect(screen.getByRole("link", { name: /open component/i })).toBeTruthy();
  });

  it("announces selection through a polite live region", () => {
    renderView();
    fireEvent.click(
      screen.getByRole("button", { name: /dep-target.*depended on by Payments API/i }),
    );
    expect(screen.getByRole("status").textContent).toMatch(/dep-target/);
  });

  it("renders an honest empty state when the catalog has no edge rows", () => {
    renderView(emptyView);
    expect(screen.getByText(/no relationships/i)).toBeTruthy();
    // Empty lanes are hidden — only the empty state renders (spec 062).
    for (const label of ["Depended on by", "Depends on", "Product dependents"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
    expect(screen.queryByText("None")).toBeNull();
  });

  it("hides relation lanes that have no data", () => {
    renderView({
      ...emptyView,
      dependsOn: [rel("only-dep")],
      instances: fullView.instances,
    });
    for (const label of [
      "Depended on by",
      "Sourced by",
      "Exposed by",
      "Product dependents",
      "Sources from",
      "Exposes",
    ]) {
      expect(screen.queryByText(label)).toBeNull();
    }
    expect(screen.getByText("Depends on")).toBeTruthy();
    expect(screen.getByText("only-dep")).toBeTruthy();
    // The focused card and its instances still render.
    expect(screen.getByText("Instances")).toBeTruthy();
    expect(screen.getByText("Production")).toBeTruthy();
  });

  it("keeps an unavailable lane's header visible even with no data", () => {
    renderView({
      ...emptyView,
      instances: fullView.instances,
      unavailableKinds: ["exposes"],
    });
    expect(screen.getByText("Exposes")).toBeTruthy();
  });

  it("shows the status legend when the canvas renders", () => {
    renderView();
    const legend = screen.getByRole("list", { name: "Legend" });
    for (const label of ["Running", "Stopped", "Error"]) {
      expect(within(legend).getByText(label)).toBeTruthy();
    }
    expect(within(legend).getByText("Path with a failing instance")).toBeTruthy();
  });

  it("omits the legend in the empty state", () => {
    renderView(emptyView);
    expect(screen.queryByRole("list", { name: "Legend" })).toBeNull();
  });

  it("marks every path destructive when the focused component has a failing instance", () => {
    const { container } = renderView({
      ...fullView,
      instances: [{ ...fullView.instances[0]!, status: "ERROR" }],
    });
    const all = container.querySelectorAll("svg path");
    const failing = container.querySelectorAll("svg path.stroke-destructive");
    expect(all.length).toBeGreaterThan(0);
    expect(failing.length).toBe(all.length);
  });

  it("keeps path strokes neutral when no instance fails", () => {
    const { container } = renderView();
    expect(container.querySelectorAll("svg path.stroke-destructive")).toHaveLength(0);
  });

  it("draws plain bezier connectors without arrowheads", () => {
    const { container } = renderView();
    expect(container.querySelector("svg marker")).toBeNull();
    for (const p of container.querySelectorAll("svg path")) {
      expect(p.getAttribute("marker-end")).toBeNull();
    }
  });

  it("still shows instances and products when Component edges are empty", () => {
    renderView({
      ...emptyView,
      productDependents: { direct: [product("only-direct")], viaGroups: [] },
      instances: fullView.instances,
    });
    expect(screen.getByText("only-direct")).toBeTruthy();
    expect(screen.getByText("Production")).toBeTruthy();
    expect(screen.queryByText(/no relationships/i)).toBeNull();
  });

  it("warns inline when a relation group is unavailable", () => {
    renderView({ ...fullView, unavailableKinds: ["exposes"] });
    expect(screen.getByText(/couldn't be loaded|unavailable/i)).toBeTruthy();
    expect(screen.getAllByText(/Exposes/i).length).toBeGreaterThan(0);
  });

  it("exposes no relationship authoring controls", () => {
    renderView();
    for (const label of [/add/i, /edit/i, /remove/i, /delete/i]) {
      expect(screen.queryByRole("button", { name: label })).toBeNull();
      expect(screen.queryByRole("link", { name: label })).toBeNull();
    }
  });

  it("renders no edge-drawing animation outside motion-safe", () => {
    const { container } = renderView();
    const paths = container.querySelectorAll("svg path");
    for (const el of paths) {
      expect(el.getAttribute("class") ?? "").not.toMatch(/transition|animate/);
    }
    const controls = container.querySelectorAll(
      'button[class*="transition"], button[class*="animate"]',
    );
    for (const el of controls) {
      expect(el.getAttribute("class")).toMatch(/motion-safe:/);
    }
  });
});
