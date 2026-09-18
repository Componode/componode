import { describe, it, expect } from "vitest";
import {
  assertSecretCoverage,
  checkKeyCollisions,
} from "../../src/utils/secret-resolver.js";

const GITHUB_SECRETS = [{ key: "token", label: "Personal access token", required: true }];

describe("assertSecretCoverage (save-time credential coverage)", () => {
  it("passes when every required key is provided", () => {
    expect(() =>
      assertSecretCoverage(GITHUB_SECRETS, ["token"]),
    ).not.toThrow();
  });

  it("passes when required keys come from several sources", () => {
    expect(() =>
      assertSecretCoverage(GITHUB_SECRETS, ["token", "extra"]),
    ).not.toThrow();
  });

  it("throws CREDENTIAL_MISSING_KEY naming the missing key", () => {
    expect(() => assertSecretCoverage(GITHUB_SECRETS, [])).toThrowError(
      expect.objectContaining({ code: "CREDENTIAL_MISSING_KEY" }),
    );
    try {
      assertSecretCoverage(GITHUB_SECRETS, []);
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toContain("token");
      expect((err as Error).message).toContain("Personal access token");
    }
  });

  it("ignores optional declarations", () => {
    const decls = [
      { key: "token", label: "Token", required: true },
      { key: "webhook", label: "Webhook secret", required: false },
    ];
    expect(() => assertSecretCoverage(decls, ["token"])).not.toThrow();
  });

  it("passes for importers declaring no secrets", () => {
    expect(() => assertSecretCoverage([], [])).not.toThrow();
  });
});

describe("checkKeyCollisions (save-time collision pre-check)", () => {
  it("passes when every key has exactly one source", () => {
    expect(() =>
      checkKeyCollisions([
        { source: 'credential "A"', keys: ["token", "user"] },
        { source: 'env ref "GH_PASS"', keys: ["pass"] },
      ]),
    ).not.toThrow();
  });

  it("throws CREDENTIAL_KEY_COLLISION naming both sources", () => {
    try {
      checkKeyCollisions([
        { source: 'credential "GitHub PAT"', keys: ["token"] },
        { source: 'env ref "GITHUB_TOKEN"', keys: ["token"] },
      ]);
      expect.unreachable();
    } catch (err) {
      expect((err as { code?: string }).code).toBe("CREDENTIAL_KEY_COLLISION");
      expect((err as Error).message).toContain("token");
      expect((err as Error).message).toContain("GitHub PAT");
      expect((err as Error).message).toContain("GITHUB_TOKEN");
    }
  });

  it("detects collisions across two credentials", () => {
    expect(() =>
      checkKeyCollisions([
        { source: 'credential "A"', keys: ["token"] },
        { source: 'credential "B"', keys: ["token"] },
      ]),
    ).toThrowError(expect.objectContaining({ code: "CREDENTIAL_KEY_COLLISION" }));
  });
});
