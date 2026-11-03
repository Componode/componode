import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import { ProductMap } from "@/ux/components/products/product-map";
import type { Product, RelatedProduct, ProductTopology, TopologyComponent } from "@/ux/lib/view-types";

const product: Product = {
  id: "p-hub",
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
  componentCount: 3,
  completeness: { owner: true, description: true, dependencies: true },
  updatedAt: "2026-01-01T00:00:00Z",
};

const rel = (slug: string, over: Partial<RelatedProduct> = {}): RelatedProduct => ({
  id: `id-${slug}`,
  name: slug,
  slug,
  type: "BUSINESS_CAPABILITY",
  lifecycle: "ACTIVE",
  criticality: null,
  status: null,
  componentCount: 0,
  ...over,
});

const comp = (slug: string, over: Partial<TopologyComponent> = {}): TopologyComponent => ({
  id: `id-${slug}`,
  name: slug,
  slug,
  category: "DATABASE",
  lifecycle: "ACTIVE",
  worstStatus: null,
  ...over,
});

const fullTopology: ProductTopology = {
  composedBy: [rel("topo-parent")],
  composes: [rel("topo-child", { componentCount: 2, status: "RUNNING" })],
  consumesFrom: [rel("topo-platform", { criticality: "HIGH", type: "PLATFORM" })],
  consumedBy: [rel("topo-consumer", { status: "ERROR", componentCount: 1 })],
  dependsOnGroups: [
    { id: "g1", name: "Data services", slug: "data-services", memberCount: 4, lifecycle: "ACTIVE" },
    { id: "g2", name: "Empty group", slug: "empty-group", memberCount: 0, lifecycle: "RETIRED" },
  ],
  dependsOnComponents: [comp("landing-page", { worstStatus: "ERROR" }), comp("orders-db")],
  unavailableGroups: [],
};

const emptyTopology: ProductTopology = {
  composedBy: [],
  composes: [],
  consumesFrom: [],
  consumedBy: [],
  dependsOnGroups: [],
  dependsOnComponents: [],
  unavailableGroups: [],
};

/** Spec 061: a product whose only relations are direct component deps. */
const componentOnlyTopology: ProductTopology = {
  ...emptyTopology,
  dependsOnComponents: [comp("landing-page", { worstStatus: "ERROR" }), comp("orders-db")],
};

const renderMap = (topology: ProductTopology = fullTopology, p = product) =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <ProductMap product={p} topology={topology} />
      </TooltipProvider>
    </MemoryRouter>,
  );

afterEach(cleanup);

describe("ProductMap topology (spec 059)", () => {
  it("renders every relation family with directed lane labels", () => {
    renderMap();
    for (const label of [
      "Composed by",
      "Consumed by",
      "Composes",
      "Consumes from",
      "Depends on groups",
    ]) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    expect(screen.getByText("topo-parent")).toBeTruthy();
    expect(screen.getByText("topo-child")).toBeTruthy();
    expect(screen.getByText("topo-platform")).toBeTruthy();
    expect(screen.getByText("topo-consumer")).toBeTruthy();
    expect(screen.getByText("Data services")).toBeTruthy();
    expect(screen.getByText("Empty group")).toBeTruthy();
  });

  it("encodes actual relation direction in accessible node names", () => {
    renderMap();
    // composedBy: parent composes the focused product.
    expect(
      screen.getByRole("button", { name: /topo-parent.*composes Topo Hub/i }),
    ).toBeTruthy();
    // composes: focused product composes the child.
    expect(
      screen.getByRole("button", { name: /topo-child.*composed by Topo Hub/i }),
    ).toBeTruthy();
    // consumedBy: consumer consumes from the focused product.
    expect(
      screen.getByRole("button", { name: /topo-consumer.*consumes from Topo Hub/i }),
    ).toBeTruthy();
    // dependsOnGroups: focused product depends on the group.
    expect(
      screen.getByRole("button", { name: /Data services.*Topo Hub depends on/i }),
    ).toBeTruthy();
  });

  it("labels retired related products and groups instead of dropping them", () => {
    renderMap({
      ...fullTopology,
      consumedBy: [rel("topo-consumer", { lifecycle: "RETIRED" })],
    });
    // The retired consumer and the retired group are each labeled.
    expect(screen.getAllByText("Retired").length).toBeGreaterThanOrEqual(2);
  });

  it("shows the same product on both sides through different relations", () => {
    renderMap({
      ...fullTopology,
      composedBy: [rel("both-ways")],
      composes: [rel("both-ways")],
    });
    expect(
      screen.getByRole("button", { name: /both-ways.*composes Topo Hub/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /both-ways.*composed by Topo Hub/i }),
    ).toBeTruthy();
  });

  it("caps relation lanes at four nodes with local +N expansion", () => {
    const many = Array.from({ length: 6 }, (_, i) => rel(`child-${i}`));
    renderMap({ ...fullTopology, composes: many });
    // Only four children render before expansion.
    expect(screen.getByText("child-0")).toBeTruthy();
    expect(screen.getByText("child-3")).toBeTruthy();
    expect(screen.queryByText("child-4")).toBeNull();
    const expand = screen.getByRole("button", { name: /\+2 more/i });
    fireEvent.click(expand);
    expect(screen.getByText("child-4")).toBeTruthy();
    expect(screen.getByText("child-5")).toBeTruthy();
    // Other lanes are unaffected.
    expect(screen.getByText("topo-parent")).toBeTruthy();
  });

  it("selecting a node opens the inspection panel with product context", () => {
    renderMap();
    fireEvent.click(
      screen.getByRole("button", { name: /topo-consumer.*consumes from Topo Hub/i }),
    );
    expect(screen.getByText("Business capability")).toBeTruthy();
    expect(screen.getByText(/2 components|1 component/)).toBeTruthy();
    const open = screen.getByRole("link", { name: /open product/i });
    expect(open.getAttribute("href")).toContain("/products/topo-consumer");
  });

  it("shows no data for related products with null health", () => {
    renderMap();
    fireEvent.click(
      screen.getByRole("button", { name: /topo-parent.*composes Topo Hub/i }),
    );
    expect(screen.getByText(/no health data|no data/i)).toBeTruthy();
  });

  it("activates nodes with Enter or Space and clears with Escape", () => {
    renderMap();
    const node = screen.getByRole("button", {
      name: /topo-child.*composed by Topo Hub/i,
    });
    fireEvent.keyDown(node, { key: "Enter" });
    expect(screen.getByRole("link", { name: /open product/i })).toBeTruthy();
    fireEvent.keyDown(node, { key: "Escape" });
    expect(screen.queryByRole("link", { name: /open product/i })).toBeNull();
    fireEvent.keyDown(node, { key: " " });
    expect(screen.getByRole("link", { name: /open product/i })).toBeTruthy();
  });

  it("announces selection through a polite live region", () => {
    renderMap();
    fireEvent.click(
      screen.getByRole("button", { name: /topo-child.*composed by Topo Hub/i }),
    );
    expect(screen.getByRole("status").textContent).toMatch(/topo-child/);
  });

  it("shows an explicit empty state when the product has no relations", () => {
    renderMap(emptyTopology);
    expect(screen.getByText(/no relationships/i)).toBeTruthy();
  });

  it("warns inline when a relation family is unavailable", () => {
    renderMap({ ...fullTopology, unavailableGroups: ["consumesFrom"] });
    expect(screen.getByText(/couldn't be loaded|unavailable/i)).toBeTruthy();
    expect(screen.getAllByText(/Consumes from/i).length).toBeGreaterThan(0);
  });

  it("renders no edge-drawing animation outside motion-safe", () => {
    const { container } = renderMap();
    // Connector paths render instantly — no draw-in or opacity transition.
    const paths = container.querySelectorAll("svg path");
    for (const el of paths) {
      expect(el.getAttribute("class") ?? "").not.toMatch(/transition|animate/);
    }
    // The topology's own controls may only transition under motion-safe.
    const controls = container.querySelectorAll(
      'button[class*="transition"], button[class*="animate"]',
    );
    for (const el of controls) {
      expect(el.getAttribute("class")).toMatch(/motion-safe:/);
    }
  });
});

describe("ProductMap component dependencies (spec 061)", () => {
  it("renders direct component deps in a Depends on components lane without an empty state", () => {
    renderMap(componentOnlyTopology);
    expect(screen.getByText("Depends on components")).toBeTruthy();
    expect(screen.getByText("landing-page")).toBeTruthy();
    expect(screen.getByText("orders-db")).toBeTruthy();
    expect(screen.queryByText(/no relationships/i)).toBeNull();
  });

  it("encodes the dependency direction in accessible component node names", () => {
    renderMap(componentOnlyTopology);
    expect(
      screen.getByRole("button", { name: /landing-page.*Topo Hub depends on/i }),
    ).toBeTruthy();
  });

  it("selecting a component node opens inspection with status and Open component", () => {
    renderMap(componentOnlyTopology);
    fireEvent.click(
      screen.getByRole("button", { name: /landing-page.*Topo Hub depends on/i }),
    );
    expect(screen.getAllByText("Error").length).toBeGreaterThanOrEqual(1);
    const open = screen.getByRole("link", { name: /open component/i });
    expect(open.getAttribute("href")).toContain("/components/landing-page");
  });

  it("shows no data for a component with no status", () => {
    renderMap(componentOnlyTopology);
    fireEvent.click(
      screen.getByRole("button", { name: /orders-db.*Topo Hub depends on/i }),
    );
    expect(screen.getByText(/no health data|no data/i)).toBeTruthy();
  });

  it("labels retired component dependency targets instead of dropping them", () => {
    renderMap({
      ...emptyTopology,
      dependsOnComponents: [comp("old-thing", { lifecycle: "RETIRED" })],
    });
    expect(screen.getByText("Retired")).toBeTruthy();
  });

  it("passes an unknown category through as raw text on the node sublabel", () => {
    renderMap({
      ...emptyTopology,
      dependsOnComponents: [comp("mystery-box", { category: "WIDGET" })],
    });
    expect(screen.getByText("WIDGET")).toBeTruthy();
  });

  it("caps the components lane at four nodes with local +N expansion", () => {
    const many = Array.from({ length: 6 }, (_, i) => comp(`dep-${i}`));
    renderMap({ ...emptyTopology, dependsOnComponents: many });
    expect(screen.getByText("dep-0")).toBeTruthy();
    expect(screen.getByText("dep-3")).toBeTruthy();
    expect(screen.queryByText("dep-4")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /\+2 more/i }));
    expect(screen.getByText("dep-4")).toBeTruthy();
    expect(screen.getByText("dep-5")).toBeTruthy();
  });

  it("activates component nodes with keyboard and clears with Escape", () => {
    renderMap(componentOnlyTopology);
    const node = screen.getByRole("button", {
      name: /orders-db.*Topo Hub depends on/i,
    });
    fireEvent.keyDown(node, { key: "Enter" });
    expect(screen.getByRole("link", { name: /open component/i })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toMatch(/orders-db/);
    fireEvent.keyDown(node, { key: "Escape" });
    expect(screen.queryByRole("link", { name: /open component/i })).toBeNull();
  });

  it("keeps the empty state honest — it never claims the product depends on nothing ambiguously", () => {
    renderMap(emptyTopology);
    expect(screen.getByText(/no relationships/i)).toBeTruthy();
    expect(
      screen.getByText(/component.*group relations|no .*relations of any kind|product, component/i),
    ).toBeTruthy();
  });
});
