import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { FacetFilter } from "@/components/facet-filter";

afterEach(cleanup);

const OPTIONS = [
  { value: "A", label: "Alpha" },
  { value: "B", label: "Beta" },
  { value: "C", label: "Gamma" },
  { value: "D", label: "Delta" },
] as const;

describe("FacetFilter", () => {
  it("lists every option when the control is opened", async () => {
    render(
      <FacetFilter title="Status" options={OPTIONS} selected={[]} onChange={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /filter by status/i }));
    for (const o of OPTIONS) {
      expect(await screen.findByText(o.label)).toBeDefined();
    }
  });

  it("emits the union when an unselected option is picked", async () => {
    const onChange = vi.fn();
    render(
      <FacetFilter title="Status" options={OPTIONS} selected={["A"]} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /filter by status/i }));
    fireEvent.click((await screen.findAllByRole("option", { name: /beta/i }))[0]!);
    expect(onChange).toHaveBeenCalledWith(["A", "B"]);
  });

  it("emits the selection without a value when a selected option is picked", async () => {
    const onChange = vi.fn();
    render(
      <FacetFilter title="Status" options={OPTIONS} selected={["A", "B"]} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /filter by status/i }));
    fireEvent.click((await screen.findAllByRole("option", { name: /alpha/i }))[0]!);
    expect(onChange).toHaveBeenCalledWith(["B"]);
  });

  it("renders up to 2 pills inside the control and collapses the rest to +N", () => {
    const { container } = render(
      <FacetFilter title="Status" options={OPTIONS} selected={["A", "B", "C", "D"]} onChange={vi.fn()} />,
    );
    const control = container.querySelector("[data-facet-control]");
    expect(control?.textContent).toContain("Alpha");
    expect(control?.textContent).toContain("Beta");
    expect(control?.textContent).toContain("+2");
    expect(control?.textContent).not.toContain("Gamma");
    expect(control?.textContent).not.toContain("Delta");
  });

  it("removes a single value via its pill without opening the list", () => {
    const onChange = vi.fn();
    render(
      <FacetFilter title="Status" options={OPTIONS} selected={["A", "B"]} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /remove alpha/i }));
    expect(onChange).toHaveBeenCalledWith(["B"]);
  });

  it("clear action empties the whole selection", async () => {
    const onChange = vi.fn();
    render(
      <FacetFilter title="Status" options={OPTIONS} selected={["A", "B"]} onChange={onChange} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /filter by status/i }));
    fireEvent.click(await screen.findByText(/clear/i));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
