import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import { ComponentRelationships } from "@/ux/components/catalog/component-relationships";
import type {
  ComponentRelationshipsView,
  RelatedComponentNode,
} from "@/ux/lib/view-types";

// Spec 076 / UX-EDGE-01..04 — provenance markers on edge rows, Source/run
// links and Editor-only Hide edge in the selected-node panel.

const sessionRole = { role: "EDITOR" as string };
vi.mock("@/api/hooks/auth", () => ({
  useSession: () => ({ data: sessionRole }),
}));
const suppressMutate = vi.fn();
vi.mock("@/api/hooks/components", () => ({
  useSuppressComponentEdge: () => ({
    mutate: suppressMutate,
    isPending: false,
  }),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }),
}));

const flagState = { bomImporterEdges: true };
vi.mock("@/ux/lib/flags", () => ({
  flags: new Proxy({} as Record<string, unknown>, {
    get: (_t, p) => (p === "bomImporterEdges" ? flagState.bomImporterEdges : true),
  }),
}));

const focused: RelatedComponentNode = {
  id: "c-focus",
  name: "Payments API",
  slug: "payments-api",
  category: "WEB_ENDPOINT",
  provider: "GITHUB",
  resourceType: "web:endpoint",
  lifecycle: "ACTIVE",
};

const rel = (
  slug: string,
  over: Partial<RelatedComponentNode> = {},
): RelatedComponentNode => ({
  id: `id-${slug}`,
  name: slug,
  slug,
  category: "REPOSITORY",
  provider: "GITHUB",
  resourceType: "repo",
  lifecycle: "ACTIVE",
  ...over,
});

const importerNode = rel("dep-source", {
  edgeProvenance: "IMPORTER",
  edgeImporterSourceId: "src-1",
  edgeImporterConfigId: "cfg-1",
  edgeImportRunId: "run-1",
});
const curatedNode = rel("dep-curated", { edgeProvenance: "CURATED" });

const view = (nodes: RelatedComponentNode[]): ComponentRelationshipsView => ({
  component: focused,
  dependsOn: [],
  dependedOnBy: nodes,
  sourcesFrom: [],
  sourcedBy: [],
  exposes: [],
  exposedBy: [],
  productDependents: { direct: [], viaGroups: [] },
  instances: [],
  libraryCounts: { dependsOn: 0, dependedOnBy: 0 },
  unavailableKinds: [],
});

const renderView = (v: ComponentRelationshipsView) =>
  render(
    <MemoryRouter>
      <TooltipProvider>
        <ComponentRelationships view={v} />
      </TooltipProvider>
    </MemoryRouter>,
  );

const nodeButton = (name: string) =>
  screen.getByRole("button", { name: new RegExp(`${name}.*depends on Payments API`, "i") });

beforeEach(() => {
  flagState.bomImporterEdges = true;
  sessionRole.role = "EDITOR";
  suppressMutate.mockClear();
});
afterEach(cleanup);

describe("edge provenance (spec 076, UX-EDGE-01/02)", () => {
  it("marks importer-added edge rows and leaves curated rows unmarked", () => {
    renderView(view([importerNode, curatedNode]));
    expect(
      nodeButton("dep-source").getAttribute("aria-label"),
    ).toMatch(/Added by importer/i);
    expect(nodeButton("dep-curated").getAttribute("aria-label")).not.toMatch(
      /Added by importer/i,
    );
  });

  it("hides all provenance surfaces when the flag is off", () => {
    flagState.bomImporterEdges = false;
    renderView(view([importerNode]));
    expect(nodeButton("dep-source").getAttribute("aria-label")).not.toMatch(
      /Added by importer/i,
    );
    fireEvent.click(nodeButton("dep-source"));
    expect(screen.queryByText("Added by importer")).toBeNull();
    expect(screen.queryByText("Curated")).toBeNull();
    expect(screen.queryByTestId("hide-edge")).toBeNull();
  });

  it("shows provenance badge + Source/run links on the selected importer edge", () => {
    renderView(view([importerNode]));
    fireEvent.click(nodeButton("dep-source"));
    expect(screen.getByTestId("edge-provenance-importer")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Source" }).getAttribute("href")).toBe(
      "/sources/src-1",
    );
    expect(
      screen.getByRole("link", { name: "Import run" }).getAttribute("href"),
    ).toBe("/importers/cfg-1/runs/run-1");
  });

  it("labels curated edges Curated with no hide affordance", () => {
    renderView(view([curatedNode]));
    fireEvent.click(nodeButton("dep-curated"));
    expect(screen.getByTestId("edge-provenance-curated")).toBeTruthy();
    expect(screen.queryByTestId("hide-edge")).toBeNull();
  });
});

describe("hide edge (spec 076, UX-EDGE-03/04)", () => {
  it("Editor sees Hide edge on importer edges; confirm suppresses the pair", () => {
    renderView(view([importerNode]));
    fireEvent.click(nodeButton("dep-source"));
    fireEvent.click(screen.getByTestId("hide-edge"));
    expect(
      screen.getByText(/won't be recreated by future imports/i),
    ).toBeTruthy();
    fireEvent.click(screen.getByTestId("hide-edge-confirm"));
    // dependedOnBy is incoming — the related component is the edge source.
    expect(suppressMutate).toHaveBeenCalledWith(
      {
        edgeKind: "DEPENDS_ON",
        fromComponentId: "id-dep-source",
        toComponentId: "c-focus",
      },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it("Viewer sees provenance but no Hide edge", () => {
    sessionRole.role = "VIEWER";
    renderView(view([importerNode]));
    fireEvent.click(nodeButton("dep-source"));
    expect(screen.getByTestId("edge-provenance-importer")).toBeTruthy();
    expect(screen.queryByTestId("hide-edge")).toBeNull();
  });
});
