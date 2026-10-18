import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { CriticalityBadge } from "@/components/metadata/criticality-badge";

afterEach(cleanup);

describe("CriticalityBadge (spec 017 US3)", () => {
  it("renders the friendly label for each value", () => {
    render(<CriticalityBadge criticality="CRITICAL" />);
    expect(screen.getByText("Critical")).toBeTruthy();
  });

  it("maps urgency to badge tone classes", () => {
    const { rerender } = render(<CriticalityBadge criticality="CRITICAL" />);
    expect(screen.getByText("Critical").className).toContain("destructive");

    rerender(<CriticalityBadge criticality="HIGH" />);
    expect(screen.getByText("High").className).toContain("warning");

    rerender(<CriticalityBadge criticality="LOW" />);
    expect(screen.getByText("Low").className).toContain("muted");
  });

  it("renders nothing when unset or unknown", () => {
    const { container, rerender } = render(<CriticalityBadge criticality={null} />);
    expect(container.firstChild).toBeNull();
    rerender(<CriticalityBadge criticality="TIER_1" />);
    expect(container.firstChild).toBeNull();
  });
});
