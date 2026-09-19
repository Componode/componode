import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { DashboardPage } from "@/pages/dashboard";

vi.mock("@/api/hooks/dashboard", () => ({
  useDashboardSummary: vi.fn(),
}));

import { useDashboardSummary } from "@/api/hooks/dashboard";
const mockSummary = vi.mocked(useDashboardSummary);

const base = {
  counts: {
    products: { total: 2, byType: { BUSINESS_CAPABILITY: 1, PLATFORM: 1, CUSTOMER_FACING: 0 } },
    components: { total: 10, byLifecycle: { ACTIVE: 9, RETIRED: 1 } },
    instances: { total: 20, byStatus: { RUNNING: 18, STOPPED: 1, ERROR: 1, GONE: 0 } },
  },
  lastImportAt: "2026-09-07T09:00:00Z",
  attention: [
    {
      kind: "FAILED_RUN" as const,
      label: "github / org-scan",
      href: "/importers/cfg1/runs/run1",
      at: "2026-09-07T09:00:00Z",
    },
  ],
  lastRuns: [
    {
      configId: "cfg1",
      importerName: "github",
      configLabel: "org-scan",
      runId: "run1",
      status: "FAILED" as const,
      completedAt: "2026-09-07T09:00:00Z",
      assetsProcessed: 100,
      assetsCreated: 5,
      assetsUpdated: 95,
    },
  ],
};

afterEach(cleanup);

function renderPage() {
  return render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  );
}

describe("DashboardPage", () => {
  it("renders attention section first, then stats, then importer status", () => {
    mockSummary.mockReturnValue({ data: base, isPending: false, isFetching: false, error: null, refetch: vi.fn() } as unknown as ReturnType<typeof useDashboardSummary>);
    renderPage();
    expect(screen.getByText("Attention needed")).toBeDefined();
    expect(screen.getByText("github / org-scan")).toBeDefined();
    expect(screen.getByText("Products")).toBeDefined();
    expect(screen.getByText("Components")).toBeDefined();
    expect(screen.getByText("Instances")).toBeDefined();
    expect(screen.getByText("Importer status")).toBeDefined();
  });

  it("hides the attention section when empty", () => {
    mockSummary.mockReturnValue({
      data: { ...base, attention: [] },
      isPending: false, isFetching: false, error: null, refetch: vi.fn(),
    } as unknown as ReturnType<typeof useDashboardSummary>);
    renderPage();
    expect(screen.queryByText("Attention needed")).toBeNull();
    expect(screen.getByText("Importer status")).toBeDefined();
  });

  it("shows the getting-started strip on an empty install", () => {
    mockSummary.mockReturnValue({
      data: {
        counts: {
          products: { total: 0, byType: {} },
          components: { total: 0, byLifecycle: { ACTIVE: 0, RETIRED: 0 } },
          instances: { total: 0, byStatus: { RUNNING: 0, STOPPED: 0, ERROR: 0, GONE: 0 } },
        },
        lastImportAt: null,
        attention: [],
        lastRuns: [],
      },
      isPending: false, isFetching: false, error: null, refetch: vi.fn(),
    } as unknown as ReturnType<typeof useDashboardSummary>);
    renderPage();
    expect(screen.getByText("Get started with Componode")).toBeDefined();
    expect(screen.getByText("Configure your first importer")).toBeDefined();
    expect(screen.queryByText("Importer status")).toBeNull();
  });

  it("renders error state with retry on failure", () => {
    mockSummary.mockReturnValue({ data: undefined, isPending: false, isFetching: false, error: { code: "X", message: "nope" }, refetch: vi.fn() } as unknown as ReturnType<typeof useDashboardSummary>);
    renderPage();
    expect(screen.getByRole("alert")).toBeDefined();
    expect(screen.getByRole("button", { name: /retry/i })).toBeDefined();
  });

  // bugfix 014: at ~768px the label must ellipsize, never overlap the badge.
  it("last-run rows truncate the label instead of colliding with the badge", () => {
    mockSummary.mockReturnValue({ data: base, isPending: false, isFetching: false, error: null, refetch: vi.fn() } as unknown as ReturnType<typeof useDashboardSummary>);
    renderPage();
    const labelWrapper = screen.getByText("org-scan").parentElement!;
    expect(labelWrapper.className).toContain("min-w-0");
    expect(labelWrapper.className).toContain("truncate");
    // Supplementary importer name is demoted below `md`.
    const importerName = screen.getByText("github", { selector: "span" });
    expect(importerName.className).toContain("hidden");
    expect(importerName.className).toContain("md:inline");
    // The badge cluster keeps its no-shrink contract.
    expect(labelWrapper.nextElementSibling!.className).toContain("shrink-0");
  });
});
