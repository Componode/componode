import { describe, it, expect } from "vitest";
import {
  fieldsForSchema,
  defaultsFor,
  scopeFromValues,
  unknownKeys,
  schemaRenderable,
  type ScopeField,
} from "@/ux/components/importers/scope-schema";

const GITHUB = {
  type: "object",
  required: ["org"],
  properties: {
    org: { type: "string", minLength: 1 },
    baseUrl: { type: "string", format: "uri" },
    repos: { type: "array", items: { type: "string", minLength: 1 } },
    includeForks: { type: "boolean", default: false },
    billingPeriod: { type: "string", enum: ["current", "previous"], default: "current" },
    environmentMapping: {
      type: "object",
      additionalProperties: { type: "string", enum: ["PRODUCTION", "STAGING"] },
    },
  },
};

describe("fieldsForSchema", () => {
  it("maps each contract kind", () => {
    const fields = fieldsForSchema(GITHUB);
    const byKey = new Map(fields.map((f) => [f.key, f]));
    expect(byKey.get("org")!.kind).toBe("text");
    expect(byKey.get("baseUrl")!.kind).toBe("url");
    expect(byKey.get("repos")!.kind).toBe("string-list");
    expect(byKey.get("includeForks")!.kind).toBe("boolean");
    expect(byKey.get("billingPeriod")!.kind).toBe("enum");
    expect(byKey.get("environmentMapping")!.kind).toBe("json");
  });

  it("marks required from the schema required[] list", () => {
    const byKey = new Map(fieldsForSchema(GITHUB).map((f) => [f.key, f]));
    expect(byKey.get("org")!.required).toBe(true);
    expect(byKey.get("baseUrl")!.required).toBe(false);
  });

  it("extracts enum options and defaults", () => {
    const byKey = new Map(fieldsForSchema(GITHUB).map((f) => [f.key, f]));
    expect(byKey.get("billingPeriod")!.options).toEqual(["current", "previous"]);
    expect(byKey.get("billingPeriod")!.default).toBe("current");
    expect(byKey.get("includeForks")!.default).toBe(false);
  });

  it("maps number and integer to the number kind", () => {
    const fields = fieldsForSchema({
      type: "object",
      properties: {
        a: { type: "number" },
        b: { type: "integer" },
      },
    });
    expect(fields.map((f) => f.kind)).toEqual(["number", "number"]);
  });

  it("falls back to json for nested objects, records, and non-string arrays", () => {
    const fields = fieldsForSchema({
      type: "object",
      properties: {
        obj: { type: "object", properties: { a: { type: "string" } } },
        rec: { type: "object", additionalProperties: { type: "string" } },
        nums: { type: "array", items: { type: "number" } },
        union: { anyOf: [{ type: "string" }, { type: "number" }] },
      },
    });
    expect(fields.map((f) => f.kind)).toEqual(["json", "json", "json", "json"]);
  });

  it("preserves property declaration order", () => {
    expect(fieldsForSchema(GITHUB).map((f) => f.key)).toEqual([
      "org",
      "baseUrl",
      "repos",
      "includeForks",
      "billingPeriod",
      "environmentMapping",
    ]);
  });

  it("humanizes labels", () => {
    const byKey = new Map(fieldsForSchema(GITHUB).map((f) => [f.key, f]));
    expect(byKey.get("includeForks")!.label).toBe("Include forks");
    expect(byKey.get("org")!.label).toBe("Org");
    expect(byKey.get("baseUrl")!.label).toBe("Base URL");
  });

  it("returns [] for missing, non-object, or empty schemas", () => {
    expect(fieldsForSchema(undefined)).toEqual([]);
    expect(fieldsForSchema({})).toEqual([]);
    expect(fieldsForSchema({ type: "object" })).toEqual([]);
    expect(fieldsForSchema({ type: "object", properties: {} })).toEqual([]);
    expect(fieldsForSchema({ type: "string" })).toEqual([]);
  });
});

describe("schemaRenderable", () => {
  it("is true only for object schemas with a properties object", () => {
    expect(schemaRenderable(GITHUB)).toBe(true);
    expect(schemaRenderable({ type: "object", properties: {} })).toBe(true);
    expect(schemaRenderable({ type: "object" })).toBe(false);
    expect(schemaRenderable({ type: "string" })).toBe(false);
    expect(schemaRenderable(undefined)).toBe(false);
  });
});

describe("defaultsFor", () => {
  const fields = fieldsForSchema(GITHUB);

  it("materializes schema defaults and '' for required-without-default", () => {
    const d = defaultsFor(fields);
    expect(d.org).toBe("");
    expect(d.includeForks).toBe(false);
    expect(d.billingPeriod).toBe("current");
    // optional fields without defaults are absent — never "" submitted
    expect("baseUrl" in d).toBe(false);
    expect("repos" in d).toBe(false);
    expect("environmentMapping" in d).toBe(false);
  });
});

describe("scopeFromValues", () => {
  const fields = fieldsForSchema(GITHUB);

  it("produces the exact record the JSON editor produced", () => {
    const scope = scopeFromValues(fields, {
      org: "acme",
      baseUrl: "https://ghe.acme",
      repos: ["a", "b"],
      includeForks: true,
      billingPeriod: "previous",
      environmentMapping: { web: "PRODUCTION" },
    });
    expect(scope).toEqual({
      org: "acme",
      baseUrl: "https://ghe.acme",
      repos: ["a", "b"],
      includeForks: true,
      billingPeriod: "previous",
      environmentMapping: { web: "PRODUCTION" },
    });
  });

  it("omits empty-string optional fields but keeps required '' for validation", () => {
    const scope = scopeFromValues(fields, { org: "", baseUrl: "" });
    expect("baseUrl" in scope).toBe(false);
    expect(scope.org).toBe("");
  });

  it("keeps explicit empty string-lists (cleared defaults)", () => {
    const scope = scopeFromValues(fields, { org: "x", repos: [] });
    expect(scope.repos).toEqual([]);
  });

  it("coerces number fields", () => {
    const nf = fieldsForSchema({ type: "object", properties: { n: { type: "number" } } });
    expect(scopeFromValues(nf, { n: "42" })).toEqual({ n: 42 });
    expect(scopeFromValues(nf, { n: "" })).toEqual({});
  });

  it("merges extras (unrecognized keys) into the payload", () => {
    const scope = scopeFromValues(fields, { org: "x" }, { legacy: 1 });
    expect(scope).toEqual({ org: "x", legacy: 1 });
  });
});

describe("unknownKeys", () => {
  it("splits stored keys absent from schema properties", () => {
    const stored = { org: "acme", includeForks: true, legacyKey: "v", gone: 2 };
    expect(unknownKeys(stored, GITHUB)).toEqual({ legacyKey: "v", gone: 2 });
  });

  it("returns {} when all keys are known or schema has no properties", () => {
    expect(unknownKeys({ org: "x" }, GITHUB)).toEqual({});
    expect(unknownKeys({ a: 1 }, { type: "object" })).toEqual({});
  });
});

describe("ScopeField type", () => {
  it("exposes kind literals", () => {
    const kinds: ScopeField["kind"][] = [
      "text",
      "url",
      "boolean",
      "enum",
      "number",
      "string-list",
      "json",
    ];
    expect(kinds).toHaveLength(7);
  });
});
