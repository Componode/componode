import { describe, it, expect } from "vitest";
import { bootstrapDocumentSchema } from "../../src/schemas/bootstrap.js";

const item = { name: "Payments Shop", type: "CUSTOMER_FACING" };
const doc = (products: unknown[] = [item]) => ({ version: 1, products });

describe("bootstrapDocumentSchema", () => {
  it("accepts a minimal document", () => {
    const r = bootstrapDocumentSchema.safeParse(doc());
    expect(r.success).toBe(true);
  });

  it("accepts a full item including owner slugs and dependsOn refs", () => {
    const r = bootstrapDocumentSchema.safeParse(
      doc([
        {
          ...item,
          description: "Storefront",
          owner: { lob: "retail", team: "shop-platform" },
          tags: ["checkout", "storefront"],
          criticality: "HIGH",
          sunsetAt: "2027-01-01T00:00:00Z",
          dependsOn: ["payments-db", "stripe-api"],
        },
      ]),
    );
    expect(r.success).toBe(true);
  });

  it("rejects a version other than 1", () => {
    expect(bootstrapDocumentSchema.safeParse({ version: 2, products: [] }).success).toBe(false);
    expect(bootstrapDocumentSchema.safeParse({ products: [] }).success).toBe(false);
  });

  it("rejects unknown fields at root, item, and owner level", () => {
    expect(
      bootstrapDocumentSchema.safeParse({ ...doc(), extra: true }).success,
    ).toBe(false);
    expect(
      bootstrapDocumentSchema.safeParse(doc([{ ...item, foo: 1 }])).success,
    ).toBe(false);
    expect(
      bootstrapDocumentSchema.safeParse(
        doc([{ ...item, owner: { lob: "x", bogus: "y" } }]),
      ).success,
    ).toBe(false);
  });

  it("rejects malformed items with per-item error paths", () => {
    const r = bootstrapDocumentSchema.safeParse(
      doc([item, { name: "Bad", type: "NOPE" }]),
    );
    expect(r.success).toBe(false);
    if (!r.success) {
      const paths = r.error.issues.map((i) => i.path.join("."));
      expect(paths.some((p) => p.startsWith("products.1"))).toBe(true);
    }
  });

  it("rejects non-string dependsOn entries and overlong names", () => {
    expect(
      bootstrapDocumentSchema.safeParse(
        doc([{ ...item, dependsOn: [123] }]),
      ).success,
    ).toBe(false);
    expect(
      bootstrapDocumentSchema.safeParse(
        doc([{ ...item, name: "x".repeat(201) }]),
      ).success,
    ).toBe(false);
  });

  it("rejects bad tags and criticality", () => {
    expect(
      bootstrapDocumentSchema.safeParse(
        doc([{ ...item, tags: ["UPPER CASE!"] }]),
      ).success,
    ).toBe(false);
    expect(
      bootstrapDocumentSchema.safeParse(
        doc([{ ...item, criticality: "URGENT" }]),
      ).success,
    ).toBe(false);
  });

  it("accepts large wellformed documents — size limits are the API's, not the schema's", () => {
    const many = Array.from({ length: 2001 }, (_, i) => ({
      name: `Product ${i}`,
      type: "PLATFORM",
      dependsOn: Array.from({ length: 600 }, () => `ref-${"x".repeat(300)}`),
    }));
    expect(bootstrapDocumentSchema.safeParse(doc(many)).success).toBe(true);
  });

  it("accepts an empty products array", () => {
    const r = bootstrapDocumentSchema.safeParse({ version: 1, products: [] });
    expect(r.success).toBe(true);
  });

  it("accepts null owner sub-keys (clear semantics) and null nullable fields", () => {
    const r = bootstrapDocumentSchema.safeParse(
      doc([
        {
          ...item,
          owner: { lob: null, team: null },
          description: null,
          criticality: null,
          sunsetAt: null,
        },
      ]),
    );
    expect(r.success).toBe(true);
  });
});
