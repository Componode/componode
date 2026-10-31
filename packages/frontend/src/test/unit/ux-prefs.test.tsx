import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { loadPrefs, savePref, useUxPrefs, UxPrefsSync } from "@/ux/lib/prefs";
import { RelativeTime } from "@/ux/components/patterns/primitives";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import { renderHook } from "@testing-library/react";

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("loadPrefs / savePref (spec 041)", () => {
  it("returns defaults for empty and corrupt storage", () => {
    expect(loadPrefs()).toEqual({ density: "comfortable", reduceMotion: false, relativeTime: true });
    localStorage.setItem("ux.prefs", "not-json{{{");
    expect(loadPrefs()).toEqual({ density: "comfortable", reduceMotion: false, relativeTime: true });
  });

  it("round-trips values and coerces unknowns to defaults", () => {
    savePref("density", "compact");
    savePref("reduceMotion", true);
    savePref("relativeTime", false);
    expect(loadPrefs()).toEqual({ density: "compact", reduceMotion: true, relativeTime: false });
    localStorage.setItem("ux.prefs", JSON.stringify({ density: "weird" }));
    expect(loadPrefs().density).toBe("comfortable");
  });

  it("notifies useUxPrefs subscribers live", () => {
    const { result } = renderHook(() => useUxPrefs());
    expect(result.current.density).toBe("comfortable");
    act(() => savePref("density", "compact"));
    expect(result.current.density).toBe("compact");
  });
});

describe("UxPrefsSync", () => {
  it("sets and clears root attributes from prefs", () => {
    render(<UxPrefsSync />);
    expect(document.documentElement.dataset.density).toBe("comfortable");
    expect(document.documentElement.hasAttribute("data-reduce-motion")).toBe(false);
    act(() => {
      savePref("density", "compact");
      savePref("reduceMotion", true);
    });
    expect(document.documentElement.dataset.density).toBe("compact");
    expect(document.documentElement.hasAttribute("data-reduce-motion")).toBe(true);
    act(() => savePref("reduceMotion", false));
    expect(document.documentElement.hasAttribute("data-reduce-motion")).toBe(false);
  });
});

describe("RelativeTime pref (spec 041)", () => {
  const ISO = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
  const renderTime = () =>
    render(
      <TooltipProvider>
        <RelativeTime iso={ISO} />
      </TooltipProvider>,
    );

  it("renders the relative label by default and absolute when pref is off", () => {
    renderTime();
    expect(document.querySelector("time")!.textContent).toContain("ago");
    act(() => savePref("relativeTime", false));
    renderTime();
    expect(document.querySelector("time")!.textContent).not.toContain("ago");
  });
});

describe("Appearance settings page (spec 041)", () => {
  it("renders all three pref controls enabled and writes prefs on toggle", async () => {
    const { UxSettingsAppearancePage } = await import("@/ux/app/settings/appearance");
    render(<UxSettingsAppearancePage />);
    for (const id of ["density", "reduce-motion", "relative-time"]) {
      const el = document.getElementById(id);
      expect(el).not.toBeNull();
      expect((el as HTMLButtonElement).disabled).toBe(false);
    }
    act(() => {
      document.getElementById("reduce-motion")!.click();
    });
    expect(loadPrefs().reduceMotion).toBe(true);
  });
});
