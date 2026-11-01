import { describe, it, expect, afterEach, vi } from "vitest";
import { render, cleanup, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import { SourcesView } from "@/ux/components/sources/sources-view";
import { SourceDetail } from "@/ux/components/sources/source-detail";
import type { ImporterSource } from "@/ux/lib/view-types";

vi.mock("@/api/hooks/auth", () => ({
  useSession: vi.fn(() => ({ data: { role: "VIEWER" } })),
}));
vi.mock("@/api/hooks/importer-sources", () => ({
  useRetireSource: () => ({ mutate: vi.fn(), isPending: false }),
  useReactivateSource: () => ({ mutate: vi.fn(), isPending: false }),
}));

const wrap = (el: React.ReactElement) =>
  render(
    <MemoryRouter>
      <TooltipProvider>{el}</TooltipProvider>
    </MemoryRouter>,
  );

function source(over: Partial<ImporterSource> = {}): ImporterSource {
  return {
    id: "s1",
    importerName: "docker",
    provider: "DOCKER",
    externalIdentity: "docker-engine:eng-1",
    label: "prod-daemon",
    status: "ACTIVE",
    boundConfig: { id: "cfg1", label: "prod-docker" },
    lastCompletedRunAt: "2026-11-01T00:00:00Z",
    activeComponentMemberships: 3,
    activeInstanceMemberships: 5,
    firstSeenInRunId: null,
    lastSeenInRunId: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    ...over,
  };
}

afterEach(cleanup);

describe("SourcesView (spec 047)", () => {
  it("renders all lifecycle states with identity, importer, bound config, counts", () => {
    wrap(
      <SourcesView
        sources={[
          source(),
          source({ id: "s2", status: "UNMONITORED", boundConfig: null, externalIdentity: "docker-engine:eng-2", label: null }),
          source({ id: "s3", status: "RETIRED", externalIdentity: "docker-engine:eng-3", label: "old-daemon" }),
        ]}
      />,
    );
    expect(screen.getAllByText("prod-daemon").length).toBeGreaterThan(0);
    expect(screen.getAllByText("prod-docker").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Unmonitored").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Retired").length).toBeGreaterThan(0);
  });

  it("renders an explanatory empty state", () => {
    wrap(<SourcesView sources={[]} />);
    expect(screen.getByText("No importer sources yet")).toBeTruthy();
    expect(screen.getByText(/reports source identity/)).toBeTruthy();
  });
});

describe("SourceDetail (spec 047)", () => {
  it("explains UNMONITORED reattach; hides lifecycle buttons for non-admin", () => {
    wrap(
      <SourceDetail
        source={source({ status: "UNMONITORED", boundConfig: null })}
        runs={[]}
        memberships={undefined}
        events={[]}
      />,
    );
    expect(screen.getByText(/rebinds automatically/)).toBeTruthy();
    expect(screen.queryByText(/Retire source|Reactivate source/)).toBeNull();
  });
});
