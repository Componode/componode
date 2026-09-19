import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen, within } from "@testing-library/react";
import { ImporterRunChart } from "@/components/importer-run-chart";
import type { ImportRun } from "@/api/types";

vi.mock("@tanstack/react-query", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@tanstack/react-query")>();
  return { ...orig, useQueries: vi.fn() };
});

import { useQueries } from "@tanstack/react-query";
const mockUseQueries = vi.mocked(useQueries);

function run(over: Partial<ImportRun>): ImportRun {
  return {
    id: "r1",
    configId: "cfg1",
    status: "COMPLETED",
    triggeredBy: null,
    startedAt: "2026-09-18T10:00:00Z",
    completedAt: "2026-09-18T10:01:00Z",
    assetsProcessed: 10,
    assetsCreated: 4,
    assetsUpdated: 3,
    instancesOrphaned: 0,
    componentsRetired: 0,
    currentPhase: null,
    cancelRequestedAt: null,
    errorMessage: null,
    errorStack: null,
    errorType: null,
    credentialIds: null,
    createdAt: "2026-09-18T10:00:00Z",
    ...over,
  };
}

/** Emulate the chart's useQueries fan-out: one entry per configId. */
function stubQueries(runsByConfig: ImportRun[][]) {
  mockUseQueries.mockReturnValue(
    runsByConfig.map((runs) => ({
      data: { runs },
      isPending: false,
    })) as unknown as ReturnType<typeof useQueries>,
  );
}

function dataTable() {
  return screen.getByRole("table", { name: /import run history/i });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ImporterRunChart", () => {
  it("fans out one query per config id", () => {
    stubQueries([[], [], []]);
    render(<ImporterRunChart configIds={["a", "b", "c"]} />);
    const queries = (mockUseQueries.mock.calls[0]![0] as { queries: unknown[] })
      .queries;
    expect(queries).toHaveLength(3);
  });

  it("renders one stacked bar per run with correct segment values", () => {
    stubQueries([
      [
        run({
          id: "r1",
          completedAt: "2026-09-17T10:01:00Z",
          assetsProcessed: 10,
          assetsCreated: 4,
          assetsUpdated: 3,
        }),
        run({
          id: "r2",
          completedAt: "2026-09-18T10:01:00Z",
          assetsProcessed: 7,
          assetsCreated: 7,
          assetsUpdated: 0,
        }),
      ],
      [
        run({
          id: "r3",
          configId: "cfg2",
          completedAt: "2026-09-18T12:01:00Z",
          assetsProcessed: 5,
          assetsCreated: 0,
          assetsUpdated: 5,
        }),
      ],
    ]);
    render(<ImporterRunChart configIds={["cfg1", "cfg2"]} />);

    const rows = within(dataTable()).getAllByRole("row");
    // 1 header + 3 runs (recency-ascending: r1, r2, r3)
    expect(rows).toHaveLength(4);
    expect(within(rows[1]!).getAllByRole("cell").map((c) => c.textContent))
      .toEqual(["4", "3", "3", "10"]); // unchanged = 10-4-3
    expect(within(rows[2]!).getAllByRole("cell").map((c) => c.textContent))
      .toEqual(["7", "0", "0", "7"]);
    expect(within(rows[3]!).getAllByRole("cell").map((c) => c.textContent))
      .toEqual(["0", "5", "0", "5"]);
  });

  it("renders a single run", () => {
    stubQueries([[run({ assetsProcessed: 2, assetsCreated: 1, assetsUpdated: 1 })]]);
    render(<ImporterRunChart configIds={["cfg1"]} />);
    expect(within(dataTable()).getAllByRole("row")).toHaveLength(2);
  });

  it("renders runs with all-zero counts", () => {
    stubQueries([[run({ assetsProcessed: 0, assetsCreated: 0, assetsUpdated: 0 })]]);
    render(<ImporterRunChart configIds={["cfg1"]} />);
    const rows = within(dataTable()).getAllByRole("row");
    expect(rows).toHaveLength(2);
    expect(within(rows[1]!).getAllByRole("cell").map((c) => c.textContent))
      .toEqual(["0", "0", "0", "0"]);
  });

  it("shows the standard empty state when there are no runs", () => {
    stubQueries([[]]);
    render(<ImporterRunChart configIds={["cfg1"]} />);
    expect(screen.getByText(/no import runs/i)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("excludes runs that have not completed", () => {
    stubQueries([[run({ status: "RUNNING", completedAt: null })]]);
    render(<ImporterRunChart configIds={["cfg1"]} />);
    expect(screen.getByText(/no import runs/i)).toBeTruthy();
  });

  it("trims to maxRuns, keeping the most recent", () => {
    const runs = Array.from({ length: 5 }, (_, i) =>
      run({
        id: `r${i}`,
        completedAt: `2026-09-1${i}T10:00:00Z`,
        assetsCreated: i + 1,
        assetsProcessed: i + 1,
        assetsUpdated: 0,
      }),
    );
    stubQueries([runs]);
    render(<ImporterRunChart configIds={["cfg1"]} maxRuns={3} />);
    const rows = within(dataTable()).getAllByRole("row");
    expect(rows).toHaveLength(4);
    // Oldest two dropped; kept runs are r2,r3,r4 → created 3,4,5
    expect(within(rows[1]!).getAllByRole("cell")[0]!.textContent).toBe("3");
    expect(within(rows[3]!).getAllByRole("cell")[0]!.textContent).toBe("5");
  });

  it("renders the legend with all three segments", () => {
    stubQueries([[run({})]]);
    render(<ImporterRunChart configIds={["cfg1"]} />);
    const legend = screen.getByRole("list", { name: /chart legend/i });
    expect(within(legend).getByText("Created")).toBeTruthy();
    expect(within(legend).getByText("Updated")).toBeTruthy();
    expect(within(legend).getByText("Unchanged")).toBeTruthy();
  });
});
