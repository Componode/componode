import { describe, expect, it } from "vitest";
import {
  listProductPackageConsumersQuerySchema,
  listProductPackagesQuerySchema,
} from "../src/schemas/packages.js";

describe("listProductPackagesQuerySchema", () => {
  it("defaults to components-desc ordering and list base defaults", () => {
    const q = listProductPackagesQuerySchema.parse({});
    expect(q.sort).toBe("components");
    expect(q.order).toBe("desc");
    expect(q.page).toBe(1);
    expect(q.pageSize).toBe(25);
  });

  it("parses CSV ecosystem filters", () => {
    const q = listProductPackagesQuerySchema.parse({
      ecosystem: "npm,deb",
    });
    expect(q.ecosystem).toEqual(["npm", "deb"]);
  });

  it("coerces the skew flag to boolean", () => {
    expect(listProductPackagesQuerySchema.parse({ skew: "true" }).skew).toBe(
      true,
    );
    expect(listProductPackagesQuerySchema.parse({ skew: "1" }).skew).toBe(
      true,
    );
    expect(listProductPackagesQuerySchema.parse({ skew: "false" }).skew).toBe(
      false,
    );
    expect(listProductPackagesQuerySchema.parse({}).skew).toBeUndefined();
  });

  it("accepts declared and undeclared values", () => {
    expect(
      listProductPackagesQuerySchema.parse({ declared: "declared" }).declared,
    ).toBe("declared");
    expect(
      listProductPackagesQuerySchema.parse({ declared: "undeclared" })
        .declared,
    ).toBe("undeclared");
  });

  it("rejects invalid declared values", () => {
    expect(
      listProductPackagesQuerySchema.safeParse({ declared: "maybe" }).success,
    ).toBe(false);
  });

  it("rejects invalid sort keys", () => {
    expect(
      listProductPackagesQuerySchema.safeParse({ sort: "purl" }).success,
    ).toBe(false);
  });

  it("accepts the sort whitelist", () => {
    for (const sort of ["name", "components", "versions", "ecosystem"]) {
      expect(
        listProductPackagesQuerySchema.safeParse({ sort }).success,
      ).toBe(true);
    }
  });

  it("rejects unknown params (strict)", () => {
    expect(
      listProductPackagesQuerySchema.safeParse({ bogus: "1" }).success,
    ).toBe(false);
  });
});

describe("listProductPackageConsumersQuerySchema", () => {
  it("requires purl and defaults sort to name", () => {
    const q = listProductPackageConsumersQuerySchema.parse({
      purl: "pkg:npm/lodash",
    });
    expect(q.purl).toBe("pkg:npm/lodash");
    expect(q.sort).toBe("name");
    expect(q.order).toBe("asc");
  });

  it("rejects a missing or empty purl", () => {
    expect(
      listProductPackageConsumersQuerySchema.safeParse({}).success,
    ).toBe(false);
    expect(
      listProductPackageConsumersQuerySchema.safeParse({ purl: "" }).success,
    ).toBe(false);
  });

  it("accepts an optional version filter", () => {
    const q = listProductPackageConsumersQuerySchema.parse({
      purl: "pkg:npm/lodash",
      version: "4.17.21",
    });
    expect(q.version).toBe("4.17.21");
  });

  it("rejects invalid sort keys", () => {
    expect(
      listProductPackageConsumersQuerySchema.safeParse({
        purl: "pkg:npm/lodash",
        sort: "purl",
      }).success,
    ).toBe(false);
  });

  it("rejects unknown params (strict)", () => {
    expect(
      listProductPackageConsumersQuerySchema.safeParse({
        purl: "pkg:npm/lodash",
        bogus: "1",
      }).success,
    ).toBe(false);
  });
});
