import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { StatusBadge } from "@/components/states/status-badge";

afterEach(cleanup);

describe("StatusBadge", () => {
  it("renders the status label", () => {
    render(<StatusBadge status="RUNNING" />);
    expect(screen.getByText("RUNNING")).toBeDefined();
  });

  it("renders a leading status dot alongside the label", () => {
    const { container } = render(<StatusBadge status="ACTIVE" />);
    const dot = container.querySelector("[data-status-dot]");
    expect(dot).not.toBeNull();
    expect(dot?.className).toMatch(/rounded-full/);
    expect(dot?.className).toMatch(/bg-current/);
    expect(dot?.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps the fixed enum→color mapping (success tint for healthy)", () => {
    const { container } = render(<StatusBadge status="RUNNING" />);
    const badge = container.firstElementChild;
    expect(badge?.className).toMatch(/bg-success\/15/);
    expect(badge?.className).toMatch(/text-success/);
  });

  it("keeps the mapping for error statuses", () => {
    const { container } = render(<StatusBadge status="ERROR" />);
    const badge = container.firstElementChild;
    expect(badge?.className).toMatch(/text-destructive/);
  });
});
