import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, fireEvent, act, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/app-shell";

vi.mock("@/api/hooks/auth", () => ({
  useSession: vi.fn(() => ({ data: { username: "admin", role: "ADMIN" } })),
  useLogout: vi.fn(() => ({ mutateAsync: vi.fn(), isPending: false })),
}));
vi.mock("@/components/command-palette", () => ({ CommandPalette: () => null }));

import { useSession } from "@/api/hooks/auth";
const mockUseSession = vi.mocked(useSession);

const originalMatchMedia = window.matchMedia;
type MqListener = () => void;
const mqListeners: MqListener[] = [];
let narrowViewport = false;

/** Stub viewports; narrow=true simulates <768px for both min-/max-width queries. */
function stubViewport(narrow: boolean) {
  narrowViewport = narrow;
  window.matchMedia = ((query: string) => ({
    get matches() {
      return query.includes("max-width") ? narrowViewport
        : query.includes("min-width") ? !narrowViewport
        : false;
    },
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_: string, cb: MqListener) => mqListeners.push(cb),
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

function resizeTo(narrow: boolean) {
  narrowViewport = narrow;
  mqListeners.forEach((cb) => cb());
}

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

afterEach(() => {
  cleanup();
  window.matchMedia = originalMatchMedia;
  mqListeners.length = 0;
  sessionStorage.clear();
  mockUseSession.mockReturnValue({ data: { username: "admin", role: "ADMIN" } } as ReturnType<typeof useSession>);
});

describe("NavDrawer (US3)", () => {
  it("top bar carries a hamburger visible only below md", () => {
    stubViewport(true);
    renderShell();
    const hamburger = screen.getByRole("button", { name: /open navigation/i });
    expect(hamburger.className).toContain("md:hidden");
  });

  it("sidebar chrome is hidden below md (drawer replaces it)", () => {
    stubViewport(true);
    renderShell();
    expect(screen.getByTestId("sidebar").className).toContain("hidden");
    expect(screen.getByTestId("sidebar").className).toContain("md:flex");
  });

  it("opens a left drawer with the same grouped sections incl. admin gating", async () => {
    stubViewport(true);
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: /open navigation/i }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.getAttribute("aria-label") ?? "").toMatch(/navigation/i);
    expect(screen.getByText("Catalog")).toBeDefined();
    expect(screen.getByText("Administration")).toBeDefined(); // ADMIN role
    expect(screen.getByText("Dashboard")).toBeDefined();
  });

  it("hides the admin section for non-admin users", async () => {
    mockUseSession.mockReturnValue({ data: { username: "v", role: "VIEWER" } } as ReturnType<typeof useSession>);
    stubViewport(true);
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: /open navigation/i }));
    await screen.findByRole("dialog");
    expect(screen.getByText("Catalog")).toBeDefined();
    expect(screen.queryByText("Administration")).toBeNull();
  });

  it("closes on Escape", async () => {
    stubViewport(true);
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: /open navigation/i }));
    await screen.findByRole("dialog");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes via the explicit close control and returns focus to the hamburger", async () => {
    stubViewport(true);
    renderShell();
    const hamburger = screen.getByRole("button", { name: /open navigation/i });
    hamburger.focus(); // jsdom click does not focus — Radix restores the pre-open focus
    fireEvent.click(hamburger);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: /^close$/i }));
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(hamburger));
  });

  it("dismisses cleanly when the viewport crosses to >=md", async () => {
    stubViewport(true);
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: /open navigation/i }));
    await screen.findByRole("dialog");
    act(() => resizeTo(false));
    expect(screen.queryByRole("dialog")).toBeNull();
    // sidebar chrome resumes (no stuck overlay, no duplicate nav)
    expect(screen.getByTestId("sidebar")).toBeDefined();
  });
});
