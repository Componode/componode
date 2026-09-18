import { describe, it, expect } from "vitest";

// The service module loads db/connection.js which requires DATABASE_URL at
// module init; the pool stays idle because these helpers never query.
process.env.DATABASE_URL ??= "postgres://localhost:5432/componode_test";

const { deriveCredentialSlug, computeKeyHints } = await import(
  "../../src/services/credential-service.js"
);

describe("credential service helpers", () => {
  describe("deriveCredentialSlug", () => {
    it("slugifies a label", () => {
      expect(deriveCredentialSlug("GitHub Prod PAT")).toBe("github-prod-pat");
    });

    it("strips non-alphanumeric characters and collapses dashes", () => {
      expect(deriveCredentialSlug("AWS — prod (admin)!!")).toBe("aws-prod-admin");
    });

    it("handles labels that produce empty slugs", () => {
      expect(deriveCredentialSlug("!!!")).toBe("credential");
    });
  });

  describe("computeKeyHints", () => {
    it("keeps only the last 4 characters of each value", () => {
      expect(computeKeyHints({ token: "ghp_supersecret" })).toEqual({ token: "cret" });
    });

    it("masks short values entirely so the hint stays non-reversible", () => {
      expect(computeKeyHints({ k: "ab" })).toEqual({ k: "****" });
      expect(computeKeyHints({ k: "abcd" })).toEqual({ k: "****" });
      expect(computeKeyHints({ k: "abcde" })).toEqual({ k: "****" });
    });

    it("handles multiple keys", () => {
      expect(computeKeyHints({ a: "12345678", b: "xyz" })).toEqual({ a: "5678", b: "****" });
    });
  });
});
