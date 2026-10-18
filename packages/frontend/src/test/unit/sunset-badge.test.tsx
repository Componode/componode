import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { SunsetBadge, sunsetBadge } from "@/components/metadata/sunset-badge";

afterEach(cleanup);

const NOW = new Date("2027-01-01T00:00:00.000Z");
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000).toISOString();

describe("sunsetBadge derivation (spec 017 US4)", () => {
  it("returns null when unset or malformed", () => {
    expect(sunsetBadge(null, "ACTIVE", NOW)).toBeNull();
    expect(sunsetBadge("not-a-date", "ACTIVE", NOW)).toBeNull();
  });

  it("shows a neutral date for >30 days out", () => {
    const s = sunsetBadge(inDays(60), "ACTIVE", NOW);
    expect(s).toEqual({ label: "Sunset 2027-03-02", tone: "neutral" });
  });

  it("shows an amber countdown for ≤30 days", () => {
    expect(sunsetBadge(inDays(10), "ACTIVE", NOW)).toEqual({ label: "Sunset in 10d", tone: "warning" });
    expect(sunsetBadge(inDays(30), "ACTIVE", NOW)!.tone).toBe("warning");
  });

  it("shows destructive overdue when past and still ACTIVE", () => {
    expect(sunsetBadge(inDays(-5), "ACTIVE", NOW)).toEqual({ label: "Sunset overdue", tone: "destructive" });
  });

  it("suppresses overdue for RETIRED entities", () => {
    const s = sunsetBadge(inDays(-5), "RETIRED", NOW);
    expect(s!.tone).toBe("neutral");
    expect(s!.label).toMatch(/^Sunset \d{4}-\d{2}-\d{2}$/);
  });
});

describe("SunsetBadge component", () => {
  it("renders nothing without a date and the overdue label when past", () => {
    const { container, rerender } = render(<SunsetBadge sunsetAt={null} lifecycle="ACTIVE" />);
    expect(container.firstChild).toBeNull();
    rerender(<SunsetBadge sunsetAt="2020-01-01T00:00:00.000Z" lifecycle="ACTIVE" />);
    expect(screen.getByText("Sunset overdue")).toBeTruthy();
  });
});
