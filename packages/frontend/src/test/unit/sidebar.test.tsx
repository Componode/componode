import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Sidebar } from "@/components/layout/sidebar";

vi.mock("@/api/hooks/auth", () => ({
  useSession: vi.fn(),
}));

import { useSession } from "@/api/hooks/auth";
const mockUseSession = vi.mocked(useSession);

function renderSidebar() {
  return render(
    <MemoryRouter>
      <Sidebar />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});

beforeEach(() => {
  mockUseSession.mockReturnValue({
    data: { id: "1", username: "alice", role: "ADMIN" },
  } as ReturnType<typeof useSession>);
});

describe("Sidebar", () => {
  it("renders grouped sections with all nav items for admins", () => {
    renderSidebar();
    expect(screen.getByText("Catalog")).toBeDefined();
    expect(screen.getByText("Sources")).toBeDefined();
    expect(screen.getByText("Administration")).toBeDefined();
    expect(screen.getByText("Dashboard")).toBeDefined();
    expect(screen.getByText("Component Groups")).toBeDefined();
    expect(screen.getByText("Importers")).toBeDefined();
    expect(screen.getByText("Users")).toBeDefined();
  });

  it("hides the Administration section for non-admin users", () => {
    mockUseSession.mockReturnValue({
      data: { id: "2", username: "bob", role: "VIEWER" },
    } as ReturnType<typeof useSession>);
    renderSidebar();
    expect(screen.queryByText("Administration")).toBeNull();
    expect(screen.queryByText("Users")).toBeNull();
    expect(screen.getByText("Components")).toBeDefined();
  });

  it("marks the active route", () => {
    render(
      <MemoryRouter initialEntries={["/components"]}>
        <Sidebar />
      </MemoryRouter>,
    );
    const link = screen.getByText("Components").closest("a");
    expect(link?.getAttribute("aria-current")).toBe("page");
  });

  it("collapses to icons and persists the choice in sessionStorage", () => {
    renderSidebar();
    fireEvent.click(screen.getByRole("button", { name: /collapse sidebar/i }));
    expect(sessionStorage.getItem("sidebar-collapsed")).toBe("true");
    expect(screen.getByTestId("sidebar").dataset.collapsed).toBe("true");
    // Section labels hidden when collapsed
    expect(screen.queryByText("Catalog")).toBeNull();
  });
});

const originalMatchMedia = window.matchMedia;

/** Stub the viewport as narrow (below `lg`) or wide for matchMedia queries. */
function stubViewport(narrow: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: narrow && query.includes("max-width"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe("Sidebar width-aware default (bugfix 014)", () => {
  it("defaults to the icon rail on a narrow viewport with no stored preference", () => {
    stubViewport(true);
    renderSidebar();
    expect(screen.getByTestId("sidebar").dataset.collapsed).toBe("true");
  });

  it("defaults to expanded on a wide viewport with no stored preference", () => {
    stubViewport(false);
    renderSidebar();
    expect(screen.getByTestId("sidebar").dataset.collapsed).toBe("false");
  });

  it("explicit expanded choice wins on a narrow viewport", () => {
    stubViewport(true);
    sessionStorage.setItem("sidebar-collapsed", "false");
    renderSidebar();
    expect(screen.getByTestId("sidebar").dataset.collapsed).toBe("false");
  });

  it("explicit collapsed choice wins on a wide viewport", () => {
    stubViewport(false);
    sessionStorage.setItem("sidebar-collapsed", "true");
    renderSidebar();
    expect(screen.getByTestId("sidebar").dataset.collapsed).toBe("true");
  });

  it("does not write a preference on mount — only an explicit toggle persists", () => {
    stubViewport(true);
    renderSidebar();
    expect(sessionStorage.getItem("sidebar-collapsed")).toBeNull();
  });

  it("falls back to the width-based default when sessionStorage is unavailable", () => {
    stubViewport(true);
    const spy = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new DOMException("denied", "SecurityError");
      });
    renderSidebar();
    expect(screen.getByTestId("sidebar").dataset.collapsed).toBe("true");
    spy.mockRestore();
  });
});
