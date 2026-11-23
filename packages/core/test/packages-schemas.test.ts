import { describe, expect, it } from "vitest";
import {
  listPackageConsumersQuerySchema,
  listPackagesQuerySchema,
} from "../src/schemas/packages.js";

describe("listPackagesQuerySchema", () => {
  it("defaults to components-desc ordering and list base defaults", () => {
    const q = listPackagesQuerySchema.parse({});
    expect(q.sort).toBe("components");
    expect(q.order).toBe("desc");
    expect(q.page).toBe(1);
    expect(q.pageSize).toBe(25);
  });

  it("parses CSV ecosystem and scope filters", () => {
    const q = listPackagesQuerySchema.parse({
      ecosystem: "npm,deb",
      scope: "RUNTIME,DEV",
    });
    expect(q.ecosystem).toEqual(["npm", "deb"]);
    expect(q.scope).toEqual(["RUNTIME", "DEV"]);
  });

  it("accepts array-valued filters", () => {
    const q = listPackagesQuerySchema.parse({ scope: ["RUNTIME"] });
    expect(q.scope).toEqual(["RUNTIME"]);
  });

  it("rejects scopes outside the enum", () => {
    expect(
      listPackagesQuerySchema.safeParse({ scope: "NOPE" }).success,
    ).toBe(false);
  });

  it("parses the catalog filter as a multi-value list", () => {
    const q = listPackagesQuerySchema.parse({ catalog: "linked" });
    expect(q.catalog).toEqual(["linked"]);
  });

  it("parses catalog CSV into multiple values", () => {
    const q = listPackagesQuerySchema.parse({
      catalog: "linked,suggested",
    });
    expect(q.catalog).toEqual(["linked", "suggested"]);
  });

  it("rejects unknown params (strict)", () => {
    expect(
      listPackagesQuerySchema.safeParse({ bogus: "1" }).success,
    ).toBe(false);
  });

  it("rejects invalid sort keys", () => {
    expect(
      listPackagesQuerySchema.safeParse({ sort: "purl" }).success,
    ).toBe(false);
  });
});

describe("listPackageConsumersQuerySchema", () => {
  it("requires purl and defaults sort to name", () => {
    const q = listPackageConsumersQuerySchema.parse({
      purl: "pkg:npm/lodash",
    });
    expect(q.purl).toBe("pkg:npm/lodash");
    expect(q.sort).toBe("name");
    expect(q.order).toBe("asc");
  });

  it("rejects a missing or empty purl", () => {
    expect(listPackageConsumersQuerySchema.safeParse({}).success).toBe(false);
    expect(
      listPackageConsumersQuerySchema.safeParse({ purl: "" }).success,
    ).toBe(false);
  });

  it("accepts an optional version filter", () => {
    const q = listPackageConsumersQuerySchema.parse({
      purl: "pkg:npm/lodash",
      version: "4.17.21",
    });
    expect(q.version).toBe("4.17.21");
  });

  it("rejects unknown params (strict)", () => {
    expect(
      listPackageConsumersQuerySchema.safeParse({
        purl: "pkg:npm/lodash",
        bogus: "1",
      }).success,
    ).toBe(false);
  });
});
