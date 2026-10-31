import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { StatGrid } from "@/ux/components/dashboard/stat-grid";

const counts = { products: 12, components: 40, instances: 55, importers: 3 };

const renderGrid = (props: Partial<Parameters<typeof StatGrid>[0]> = {}) =>
  render(
    <MemoryRouter>
      <StatGrid counts={counts} {...props} />
    </MemoryRouter>,
  );

afterEach(cleanup);

describe("StatGrid deltas (spec 040)", () => {
  it("renders +N this week under each delta'd card", () => {
    renderGrid({ deltas: { products: 3, components: 0, instances: 7 } });
    expect(screen.getByText("+3")).toBeTruthy();
    expect(screen.getByText("+0")).toBeTruthy(); // zero is a real value
    expect(screen.getByText("+7")).toBeTruthy();
    expect(screen.getAllByText("this week")).toHaveLength(3);
  });

  it("shows All healthy on the importers card when nothing needs attention", () => {
    renderGrid({ deltas: { products: 0, components: 0, instances: 0 }, importerIssues: 0 });
    expect(screen.getByText("All healthy")).toBeTruthy();
  });

  it("shows N need attention when importer-related items exist", () => {
    renderGrid({ deltas: { products: 0, components: 0, instances: 0 }, importerIssues: 2 });
    expect(screen.getByText("need attention")).toBeTruthy();
  });
});
