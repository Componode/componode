import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/app-shell";

// The contract under test is the shell's own layout classes; stub the
// children so their hooks/API needs stay out of scope.
vi.mock("@/components/layout/sidebar", () => ({
  Sidebar: () => <aside data-testid="sidebar" />,
}));
vi.mock("@/components/layout/top-bar", () => ({
  TopBar: () => <header />,
}));
vi.mock("@/components/command-palette", () => ({
  CommandPalette: () => null,
}));

function renderShell() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<div>page content</div>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("AppShell scroll contract (bugfix 014)", () => {
  it("bounds the shell to the viewport instead of letting the document scroll", () => {
    renderShell();
    const shell = screen.getByTestId("app-shell");
    expect(shell.className).toContain("h-dvh");
    expect(shell.className).toContain("overflow-hidden");
    expect(shell.className).not.toContain("min-h-screen");
  });

  it("makes <main> the single scroll region", () => {
    const { container } = renderShell();
    const main = container.querySelector("main");
    expect(main).not.toBeNull();
    expect(main!.className).toContain("overflow-y-auto");
    // Without min-h-0 the flex item keeps min-height:auto, grows past the
    // bounded parent and content is clipped instead of scrolled.
    expect(main!.className).toContain("min-h-0");
  });
});
