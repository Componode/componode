import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/app-shell";

vi.mock("@/api/hooks/auth", () => ({
  useSession: vi.fn(() => ({ data: { username: "admin", role: "ADMIN" } })),
  useLogout: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));
vi.mock("@/components/command-palette", () => ({ CommandPalette: () => null }));

const originalMatchMedia = window.matchMedia;

function stubViewport(narrow: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("max-width") ? narrow
      : query.includes("min-width") ? !narrow
      : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

function renderShell() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route
            path="/"
            element={<input aria-label="free text" defaultValue="" />}
          />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
  sessionStorage.clear();
});

describe("Ctrl+B sidebar/drawer shortcut (US3)", () => {
  it("toggles the desktop sidebar collapse at >=md", () => {
    stubViewport(false);
    renderShell();
    const sidebar = screen.getByTestId("sidebar");
    expect(sidebar.dataset.collapsed).toBe("false");
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(sidebar.dataset.collapsed).toBe("true");
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(sidebar.dataset.collapsed).toBe("false");
  });

  it("toggles the drawer below md", async () => {
    stubViewport(true);
    renderShell();
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(await screen.findByRole("dialog")).toBeDefined();
    fireEvent.keyDown(window, { key: "b", ctrlKey: true });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is global — fires even with focus inside an input (consistent with Ctrl+K)", () => {
    stubViewport(false);
    renderShell();
    const input = screen.getByLabelText("free text");
    input.focus();
    fireEvent.keyDown(input, { key: "b", ctrlKey: true });
    expect(screen.getByTestId("sidebar").dataset.collapsed).toBe("true");
  });

  it("responds to Cmd+B (metaKey) as well", () => {
    stubViewport(false);
    renderShell();
    fireEvent.keyDown(window, { key: "b", metaKey: true });
    expect(screen.getByTestId("sidebar").dataset.collapsed).toBe("true");
  });
});
