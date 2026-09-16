import { describe, it, expect } from "vitest";
import {
  COMPONENT_CATEGORIES,
  COMPONENT_PROVIDERS,
  ENVIRONMENTS,
  COMPONENT_LIFECYCLE,
  INSTANCE_STATUS,
  PRODUCT_TYPES,
  IMPORT_RUN_STATUS,
  ROLES,
} from "@componode/core";
import { checkConstraint } from "../../src/db/check-constraint-helper.js";

interface RawNode {
  kind: string;
  sqlFragments: string[];
  parameters: unknown[];
}

function getSqlFragment(result: ReturnType<typeof checkConstraint>): string {
  const node = result.toOperationNode() as unknown as RawNode;
  return node.sqlFragments.join("");
}

describe("check-constraint-helper", () => {
  it("generates a CHECK constraint fragment from a constant array", () => {
    const result = checkConstraint("role", ROLES);
    const sql = getSqlFragment(result);
    expect(sql).toContain("CHECK (role IN");
    expect(sql).toContain("ADMIN");
    expect(sql).toContain("EDITOR");
    expect(sql).toContain("VIEWER");
  });

  it("generates CHECK for component categories (25 values)", () => {
    const sql = getSqlFragment(checkConstraint("category", COMPONENT_CATEGORIES));
    expect(sql).toContain("category");
    expect(sql).toContain("COMPUTE");
    expect(sql).toContain("REPOSITORY");
    expect(sql).toContain("ACCOUNT");
    expect(COMPONENT_CATEGORIES).toHaveLength(25);
  });

  it("generates CHECK for component providers", () => {
    const sql = getSqlFragment(checkConstraint("provider", COMPONENT_PROVIDERS));
    expect(sql).toContain("provider");
    expect(sql).toContain("GITHUB");
    expect(sql).toContain("OTHER");
  });

  it("generates CHECK for environments", () => {
    const sql = getSqlFragment(checkConstraint("environment", ENVIRONMENTS));
    expect(sql).toContain("DEV");
    expect(sql).toContain("PRODUCTION");
  });

  it("generates CHECK for lifecycle", () => {
    const sql = getSqlFragment(checkConstraint("lifecycle", COMPONENT_LIFECYCLE));
    expect(sql).toContain("ACTIVE");
    expect(sql).toContain("RETIRED");
  });

  it("generates CHECK for instance status", () => {
    const sql = getSqlFragment(checkConstraint("status", INSTANCE_STATUS));
    expect(sql).toContain("RUNNING");
    expect(sql).toContain("GONE");
  });

  it("generates CHECK for product types", () => {
    const sql = getSqlFragment(checkConstraint("type", PRODUCT_TYPES));
    expect(sql).toContain("BUSINESS_CAPABILITY");
    expect(sql).toContain("PLATFORM");
  });

  it("generates CHECK for import run status", () => {
    const sql = getSqlFragment(checkConstraint("status", IMPORT_RUN_STATUS));
    expect(sql).toContain("PENDING");
    expect(sql).toContain("INTERRUPTED");
  });
});
