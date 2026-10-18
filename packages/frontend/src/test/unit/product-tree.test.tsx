import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProductTree } from "@/components/products/product-tree";
import type { DigitalProduct } from "@/api/types";

afterEach(cleanup);

const p = (id: string, name = id, extra: Partial<DigitalProduct> = {}): DigitalProduct => ({
  id,
  name,
  slug: id,
  type: "BUSINESS_CAPABILITY",
  lifecycle: "ACTIVE",
  createdAt: "",
  updatedAt: "",
  ...extra,
});

const renderTree = (products: DigitalProduct[], edges: { parentId: string; childId: string }[], flattened = false) =>
  render(
    <MemoryRouter>
      <ProductTree products={products} edges={edges} flattened={flattened} />
    </MemoryRouter>,
  );

describe("ProductTree", () => {
  it("renders roots and expands children", () => {
    renderTree([p("root"), p("child")], [{ parentId: "root", childId: "child" }]);
    expect(screen.getByText("root")).toBeDefined();
    expect(screen.queryByText("child")).toBeNull(); // collapsed by default
    fireEvent.click(screen.getByRole("button", { name: /expand root/i }));
    expect(screen.getByText("child")).toBeDefined();
  });

  it("marks nodes with multiple parents as shared", () => {
    renderTree(
      [p("a"), p("b"), p("shared")],
      [
        { parentId: "a", childId: "shared" },
        { parentId: "b", childId: "shared" },
      ],
    );
    fireEvent.click(screen.getByRole("button", { name: "Expand a" }));
    expect(screen.getAllByText("shared").length).toBeGreaterThan(0);
    expect(
      document.querySelector('[aria-label*="multiple parents"]'),
    ).not.toBeNull();
  });

  it("a RETIRED parent hides its subtree; multi-parent children stay visible via other parent", () => {
    renderTree(
      [p("dead", "Dead", { lifecycle: "RETIRED" }), p("alive"), p("leaf")],
      [
        { parentId: "dead", childId: "leaf" },
        { parentId: "alive", childId: "leaf" },
      ],
    );
    fireEvent.click(screen.getByRole("button", { name: /expand alive/i }));
    expect(screen.getByText("leaf")).toBeDefined();
  });

  it("flattened mode renders all matches as a flat list", () => {
    renderTree(
      [p("root"), p("child")],
      [{ parentId: "root", childId: "child" }],
      true,
    );
    expect(screen.getByTestId("product-tree").dataset.flattened).toBe("true");
    expect(screen.getByText("child")).toBeDefined();
  });

  it("renders the derived health badge per row; null renders —", () => {
    renderTree(
      [
        p("err", "Err", { status: "ERROR" }),
        p("ok", "Ok", { status: "RUNNING" }),
        p("none", "None", { status: null }),
      ],
      [],
    );
    expect(screen.getByText("ERROR")).toBeDefined();
    expect(screen.getByText("RUNNING")).toBeDefined();
  });

  it("expand-all / collapse-all controls work", () => {
    renderTree([p("r"), p("c")], [{ parentId: "r", childId: "c" }]);
    fireEvent.click(screen.getByRole("button", { name: /expand all/i }));
    expect(screen.getByText("c")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /collapse all/i }));
    expect(screen.queryByText("c")).toBeNull();
  });
});
