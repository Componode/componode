import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { useValidatedTab } from "@/ux/lib/use-validated-tab";

const TABS = ["overview", "sessions", "activity"] as const;

function makeWrapper(entry: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[entry]}>{children}</MemoryRouter>;
  };
}

describe("useValidatedTab", () => {
  it("falls back to the first tab when ?tab= is absent", () => {
    const { result } = renderHook(() => useValidatedTab(TABS), {
      wrapper: makeWrapper("/ux/users/u1"),
    });
    expect(result.current[0]).toBe("overview");
  });

  it("returns the requested tab when it is in the list", () => {
    const { result } = renderHook(() => useValidatedTab(TABS), {
      wrapper: makeWrapper("/ux/users/u1?tab=sessions"),
    });
    expect(result.current[0]).toBe("sessions");
  });

  it("falls back to the first tab for an unknown ?tab= value", () => {
    const { result } = renderHook(() => useValidatedTab(TABS), {
      wrapper: makeWrapper("/ux/users/u1?tab=zzz"),
    });
    expect(result.current[0]).toBe("overview");
  });

  it("setTab replaces the ?tab= param while preserving the pathname", () => {
    const { result } = renderHook(() => useValidatedTab(TABS), {
      wrapper: makeWrapper("/ux/users/u1?tab=overview"),
    });
    act(() => result.current[1]("activity"));
    expect(result.current[0]).toBe("activity");
  });
});
