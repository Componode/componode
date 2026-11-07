import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { render, cleanup, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { TooltipProvider } from "@/ux/components/ui/tooltip";
import { UxComponentGroupDetailPage } from "@/ux/app/component-groups/$slug";
import {
  useComponentGroup,
  useUpdateComponentGroup,
  useDeleteComponentGroup,
} from "@/api/hooks/component-groups";
import { useComponents, useAllComponents } from "@/api/hooks/components";
import { useTeams } from "@/api/hooks/org";

const updateMutate = vi.fn();
const deleteMutate = vi.fn();

vi.mock("@/api/hooks/component-groups", () => ({
  useComponentGroup: vi.fn(),
  useUpdateComponentGroup: vi.fn(),
  useDeleteComponentGroup: vi.fn(),
}));
vi.mock("@/api/hooks/components", () => ({
  useComponents: vi.fn(),
  useAllComponents: vi.fn(),
}));
vi.mock("@/api/hooks/org", () => ({ useTeams: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeAll(() => {
  // jsdom lacks the pointer-capture APIs Radix menus/selects use.
  if (typeof Element !== "undefined") {
    Element.prototype.hasPointerCapture ??= () => false;
    Element.prototype.setPointerCapture ??= () => {};
    Element.prototype.releasePointerCapture ??= () => {};
  }
});

const GROUP_SLUG = "dockers";
const GROUP_ID = "g-uuid-1";

const group = (over: Record<string, unknown> = {}) => ({
  id: GROUP_ID,
  name: "Dockers",
  slug: GROUP_SLUG,
  description: "Docker estate",
  lifecycle: "ACTIVE",
  teamOwnerId: "t1",
  teamOwnerName: "Owners Team",
  memberCount: 2,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...over,
});

const MEMBERS = [
  {
    id: "c1", name: "web-api", slug: "web-api", category: "SERVICE",
    provider: "DOCKER", resourceType: "container", lifecycle: "ACTIVE",
    componentGroupId: GROUP_ID, componentGroupName: "Dockers", instanceCount: 2,
  },
  {
    id: "c2", name: "worker", slug: "worker", category: "SERVICE",
    provider: "DOCKER", resourceType: "container", lifecycle: "ACTIVE",
    componentGroupId: GROUP_ID, componentGroupName: "Dockers", instanceCount: 1,
  },
];

const TEAMS = [
  { id: "t1", name: "Platform Team" },
  { id: "t2", name: "Data Team" },
];

// The API contract: ?group= / ?componentGroup= match component_groups.slug —
// never the group id (pinned by backend quickstart.test.ts).
const membersFor = (filters: { group?: string } | undefined) =>
  filters?.group === GROUP_SLUG ? MEMBERS : [];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={[`/component-groups/${GROUP_SLUG}`]}>
      <TooltipProvider>
        <Routes>
          <Route path="/component-groups/:slug" element={<UxComponentGroupDetailPage />} />
        </Routes>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

describe("UxComponentGroupDetailPage (bugfix 066)", () => {
  beforeEach(() => {
    vi.mocked(useComponentGroup).mockReturnValue({
      data: { group: group() }, isPending: false, error: null,
    } as never);
    vi.mocked(useUpdateComponentGroup).mockReturnValue({
      mutate: updateMutate, isPending: false,
    } as never);
    vi.mocked(useDeleteComponentGroup).mockReturnValue({
      mutate: deleteMutate, isPending: false,
    } as never);
    vi.mocked(useTeams).mockReturnValue({ data: { teams: TEAMS } } as never);
    // Both member-read hooks emulate the slug contract so the page goes red
    // while it passes the group id.
    vi.mocked(useComponents).mockImplementation(((filters: { group?: string }) => ({
      data: { data: membersFor(filters), pagination: {} },
      isPending: false, error: null,
    })) as never);
    vi.mocked(useAllComponents).mockImplementation(((filters: { group?: string }, enabled = true) => ({
      data: enabled ? membersFor(filters) : [],
      isPending: false, error: null,
    })) as never);
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("lists the group's member components", () => {
    renderPage();
    expect(screen.getByText("web-api")).toBeTruthy();
    expect(screen.getByText("worker")).toBeTruthy();
  });

  it("queries members by group slug, not id", () => {
    renderPage();
    const seen = [
      ...vi.mocked(useComponents).mock.calls.map((c) => c[0]),
      ...vi.mocked(useAllComponents).mock.calls.map((c) => c[0]),
    ];
    expect(seen.some((f) => f?.group === GROUP_SLUG)).toBe(true);
    expect(seen.every((f) => f?.group !== GROUP_ID)).toBe(true);
  });

  it("edit dialog lists teams and shows the current owner", () => {
    renderPage();
    fireEvent.click(screen.getByText("Edit group"));
    const trigger = screen.getByLabelText("Owning team");
    expect(trigger.textContent).toContain("Platform Team");

    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    expect(screen.getByRole("option", { name: "Data Team" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Unassigned" })).toBeTruthy();
  });

  it("submits teamOwnerId null when Unassigned is selected", () => {
    renderPage();
    fireEvent.click(screen.getByText("Edit group"));
    const trigger = screen.getByLabelText("Owning team");
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Unassigned" }));
    fireEvent.submit(document.querySelector("form")!);
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: GROUP_ID, teamOwnerId: null }),
      expect.anything(),
    );
  });

  it("submits the selected team id", () => {
    vi.mocked(useComponentGroup).mockReturnValue({
      data: { group: group({ teamOwnerId: null, teamOwnerName: null }) },
      isPending: false, error: null,
    } as never);
    renderPage();
    fireEvent.click(screen.getByText("Edit group"));
    const trigger = screen.getByLabelText("Owning team");
    fireEvent.pointerDown(trigger);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Data Team" }));
    fireEvent.submit(document.querySelector("form")!);
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ id: GROUP_ID, teamOwnerId: "t2" }),
      expect.anything(),
    );
  });

  it("submits description null when the field is emptied", () => {
    renderPage();
    fireEvent.click(screen.getByText("Edit group"));
    const desc = document.getElementById("edit-group-desc") as HTMLTextAreaElement;
    fireEvent.change(desc, { target: { value: "" } });
    fireEvent.submit(document.querySelector("form")!);
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({ description: null }),
      expect.anything(),
    );
  });
});
