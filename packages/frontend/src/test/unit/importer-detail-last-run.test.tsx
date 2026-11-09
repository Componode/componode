import { describe, it, expect, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import type { ReactNode } from "react";
import { ImporterDetail } from "@/ux/components/importers/importer-detail";
import type {
  ImporterRunsFilterKey,
  ImporterRunsSortKey,
} from "@/api/hooks/importers";
import type { ListState } from "@/ux/hooks/use-list-state";
import type { ImporterConfig, ImportRun } from "@/ux/lib/view-types";

/**
 * Spec 068 review T063 — the "last run failed" alert must reflect the
 * newest run overall, not `runs[0]` of the current server page (which is
 * arbitrary under non-default sort/page/filter).
 */

function wrap(children: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <TooltipProvider>{children}</TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function importer(over: Partial<ImporterConfig> = {}): ImporterConfig {
  return {
    id: "cfg-1",
    importerName: "GITHUB",
    label: "GitHub production",
    scope: {},
    schedule: null,
    scheduleLabel: "Manual only",
    enabled: true,
    credentialLabel: "github-token",
    lastRun: null,
    history: [],
    ...over,
  };
}

function run(over: Partial<ImportRun> = {}): ImportRun {
  return {
    id: "run-1",
    configId: "cfg-1",
    status: "COMPLETED",
    triggeredBy: "system",
    startedAt: "2026-11-01T10:00:00Z",
    durationSec: 12,
    assetsProcessed: 10,
    assetsCreated: 1,
    assetsUpdated: 2,
    instancesOrphaned: 0,
    componentsRetired: 0,
    currentPhase: null,
    errorMessage: null,
    errorType: null,
    ...over,
  };
}

const listState = (): ListState<ImporterRunsSortKey, ImporterRunsFilterKey> => ({
  page: 1,
  pageSize: 25,
  sort: "createdAt",
  order: "desc",
  search: "",
  filters: { status: "all" },
  defaults: {
    page: 1,
    pageSize: 25,
    sort: "createdAt",
    order: "desc",
    search: "",
    filters: { status: "all" },
  },
  setPage: () => {},
  setPageSize: () => {},
  setSort: () => {},
  setOrder: () => {},
  setSearch: () => {},
  setFilter: () => {},
  reset: () => {},
});

afterEach(cleanup);

describe("ImporterDetail last-run alert (T063)", () => {
  it("shows the failure alert from lastRun even when the current page's first run succeeded", () => {
    wrap(
      <ImporterDetail
        importer={importer()}
        runs={[run({ id: "run-old", status: "COMPLETED" })]}
        lastRun={run({ id: "run-new", status: "FAILED", errorMessage: "token expired" })}
        runsList={listState()}
      />,
    );
    expect(screen.getByText("The last run failed")).toBeTruthy();
    expect(screen.getByText(/token expired/)).toBeTruthy();
  });

  it("shows the alert when the history table page is empty but a failed run exists", () => {
    wrap(
      <ImporterDetail
        importer={importer()}
        runs={[]}
        lastRun={run({ status: "FAILED", errorMessage: "boom" })}
        runsList={listState()}
        runsPagination={{ page: 3, pageSize: 25, total: 60, pageCount: 3, hasNext: false }}
      />,
    );
    expect(screen.getByText("The last run failed")).toBeTruthy();
  });

  it("does not show the alert when the latest run succeeded", () => {
    wrap(
      <ImporterDetail
        importer={importer()}
        runs={[run({ status: "FAILED", errorMessage: "old failure on this page" })]}
        lastRun={run({ status: "COMPLETED" })}
        runsList={listState()}
      />,
    );
    expect(screen.queryByText("The last run failed")).toBeNull();
    expect(screen.queryByText(/old failure on this page/)).toBeNull();
  });
});
