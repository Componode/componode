import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CompletenessChip } from "@/components/products/completeness-chip";
import { ProductTree } from "@/components/products/product-tree";
import type { DigitalProduct, ProductCompleteness } from "@/api/types";

afterEach(cleanup);

const combos: { name: string; completeness: ProductCompleteness }[] = [
  { name: "all present", completeness: { owner: true, description: true, dependencies: true } },
  { name: "missing owner", completeness: { owner: false, description: true, dependencies: true } },
  { name: "missing description", completeness: { owner: true, description: false, dependencies: true } },
  { name: "missing dependencies", completeness: { owner: true, description: true, dependencies: false } },
  { name: "owner + description missing", completeness: { owner: false, description: false, dependencies: true } },
  { name: "owner + dependencies missing", completeness: { owner: false, description: true, dependencies: false } },
  { name: "description + dependencies missing", completeness: { owner: true, description: false, dependencies: false } },
  { name: "all missing", completeness: { owner: false, description: false, dependencies: false } },
];

describe("CompletenessChip — all 8 facet combinations (spec 023 US4)", () => {
  for (const { name, completeness } of combos) {
    it(`renders each facet independently: ${name}`, () => {
      const { container } = render(<CompletenessChip completeness={completeness} />);
      for (const key of ["owner", "description", "dependencies"] as const) {
        const facet = container.querySelector(`[data-facet="${key}"]`);
        expect(facet, `facet ${key}`).not.toBeNull();
        expect(facet!.getAttribute("data-ok")).toBe(String(completeness[key]));
      }
      // FR-014: no aggregate score text anywhere in the chip.
      expect(container.textContent).not.toMatch(/%|score|\d+\s*\/\s*3/i);
    });
  }

  it("renders nothing when completeness is absent", () => {
    const { container } = render(<CompletenessChip completeness={undefined} />);
    expect(container.firstChild).toBeNull();
  });
});

function product(overrides: Partial<DigitalProduct>): DigitalProduct {
  return {
    id: "p1",
    slug: "payments",
    name: "Payments",
    type: "CUSTOMER_FACING",
    lifecycle: "ACTIVE",
    ...overrides,
  } as DigitalProduct;
}

describe("ProductTree coverage fields (spec 023 US5)", () => {
  it("shows the completeness chip and consumed-by count on platform rows", () => {
    render(
      <MemoryRouter>
        <ProductTree
          products={[
            product({
              type: "PLATFORM",
              completeness: { owner: true, description: true, dependencies: true },
              consumedByCount: 3,
            }),
          ]}
          edges={[]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByTestId("completeness-chip")).toBeDefined();
    expect(screen.getByText("consumed by 3 products")).toBeDefined();
  });

  it("renders the muted not-consumed state at zero", () => {
    render(
      <MemoryRouter>
        <ProductTree
          products={[product({ type: "PLATFORM", consumedByCount: 0 })]}
          edges={[]}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("not consumed")).toBeDefined();
  });

  it("omits the consumer count on non-platform rows", () => {
    render(
      <MemoryRouter>
        <ProductTree
          products={[product({ type: "CUSTOMER_FACING", consumedByCount: 5 })]}
          edges={[]}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/consumed/)).toBeNull();
  });
});
