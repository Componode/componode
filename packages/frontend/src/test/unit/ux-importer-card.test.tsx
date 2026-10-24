import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import { ImporterCard } from "@/ux/components/importers/importer-card";
import type { ImporterConfig } from "@/ux/lib/view-types";

vi.mock("@/api/hooks/importers", () => ({
  useRunAggregates: vi.fn(() => ({
    data: [
      { day: "2026-10-23", created: 10, updated: 2, failed: 0 },
      { day: "2026-10-24", created: 5, updated: 1, failed: 1 },
    ],
  })),
  useTriggerImportRun: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
  useUpdateImporterConfig: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const importer = {
  id: "c1",
  label: "GitHub",
  provider: "GITHUB",
  importerName: "GITHUB",
  description: null,
  enabled: true,
  lastRun: null,
  history: [],
  scheduleLabel: "Every 6h",
  credentialLabel: "pat",
  statusLabel: "Running",
} as unknown as ImporterConfig;

const wrap = () =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <ImporterCard importer={importer} />
      </TooltipProvider>
    </MemoryRouter>,
  );

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("ImporterCard — run aggregates (spec 031, G1)", () => {
  it("renders the live sparkline, not the fallback notice", () => {
    wrap();
    expect(
      screen.getByRole("img", { name: /run history, last 14 days/i }),
    ).toBeTruthy();
    expect(
      screen.queryByText(/lands with the aggregates endpoint/i),
    ).toBeNull();
  });
});
