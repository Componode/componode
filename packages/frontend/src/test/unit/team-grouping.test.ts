import { describe, it, expect } from "vitest";
import { groupTeams } from "@/ux/lib/org-grouping";
import type { TeamEntity } from "@/api/types";

const team = (id: string, name: string, lobId: string | null = null): TeamEntity => ({
  id,
  name,
  slug: id,
  description: null,
  lobId,
  lob: null,
  memberCount: 0,
  componentCount: 0,
  createdAt: "",
  updatedAt: "",
});

const retail = [team("a", "Store Ops", "lob-retail"), team("b", "Ecomm", "lob-retail")];
const other = [team("c", "Platform Eng", "lob-platform"), team("d", "Floating")];
const all = [...retail, ...other];

describe("groupTeams (spec 034 — group, don't filter)", () => {
  it("puts the selected LOB's teams first and every other team in a second group", () => {
    const g = groupTeams(all, "lob-retail");
    expect(g.primary.map((t) => t.id)).toEqual(["a", "b"]);
    expect(g.others?.map((t) => t.id)).toEqual(["c", "d"]);
  });

  it("hides nothing — other-LOB and unassociated teams stay reachable", () => {
    const g = groupTeams(all, "lob-retail");
    expect((g.primary.length ?? 0) + (g.others?.length ?? 0)).toBe(all.length);
  });

  it("returns a single ungrouped list when no LOB is selected", () => {
    const g = groupTeams(all, null);
    expect(g.others).toBeNull();
    expect(g.primary.map((t) => t.id)).toEqual(all.map((t) => t.id));
  });

  it("also ungroups on an unknown/undefined LOB", () => {
    expect(groupTeams(all, undefined).others).toBeNull();
  });

  it("handles a LOB with no teams — primary empty, all in others", () => {
    const g = groupTeams(all, "lob-empty");
    expect(g.primary).toEqual([]);
    expect(g.others?.length).toBe(all.length);
  });
});
