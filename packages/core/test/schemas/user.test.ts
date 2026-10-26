import { describe, it, expect } from "vitest";
import { updateSelfSchema } from "../../src/schemas/user.js";

describe("updateSelfSchema", () => {
  it("accepts a displayName-only update", () => {
    const parsed = updateSelfSchema.safeParse({ displayName: "Ada Lovelace" });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ displayName: "Ada Lovelace" });
  });

  it("accepts an email-only update", () => {
    const parsed = updateSelfSchema.safeParse({ email: "ada@example.com" });
    expect(parsed.success).toBe(true);
    expect(parsed.data).toEqual({ email: "ada@example.com" });
  });

  it("accepts both fields and an empty body", () => {
    expect(
      updateSelfSchema.safeParse({ displayName: "Ada", email: "ada@example.com" }).success,
    ).toBe(true);
    expect(updateSelfSchema.safeParse({}).success).toBe(true);
  });

  it.each(["role", "isActive", "teamId", "username", "password", "id"])(
    "rejects privileged/unknown key: %s",
    (key) => {
      const parsed = updateSelfSchema.safeParse({ [key]: "x", displayName: "Ada" });
      expect(parsed.success).toBe(false);
    },
  );

  it("rejects a malformed email", () => {
    expect(updateSelfSchema.safeParse({ email: "not-an-email" }).success).toBe(false);
  });

  it("rejects a displayName over 100 chars", () => {
    expect(
      updateSelfSchema.safeParse({ displayName: "x".repeat(101) }).success,
    ).toBe(false);
    expect(
      updateSelfSchema.safeParse({ displayName: "x".repeat(100) }).success,
    ).toBe(true);
  });
});
