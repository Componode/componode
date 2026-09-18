import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveSecrets, EnvSecretResolver, resolveImportSecrets, assertRequiredSecrets, type CredentialRecord } from "../../src/utils/secret-resolver.js";
import { encryptSecrets, parseMasterKey, type Keyring } from "../../src/utils/credential-crypto.js";
import { randomBytes } from "node:crypto";
import { writeFileSync, unlinkSync, mkdtempSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("secret resolver", () => {
  describe("env resolver", () => {
    beforeEach(() => {
      process.env.TEST_SECRET = "secret-value";
    });

    afterEach(() => {
      delete process.env.TEST_SECRET;
    });

    it("resolves an env ref", async () => {
      const secrets = await resolveSecrets([{ key: "token", env: "TEST_SECRET" }]);
      expect(secrets).toEqual({ token: "secret-value" });
    });

    it("throws when env var is missing", async () => {
      await expect(resolveSecrets([{ key: "token", env: "MISSING_VAR" }])).rejects.toThrow("MISSING_VAR");
    });

    it("throws when neither env nor file is provided", async () => {
      await expect(resolveSecrets([{ key: "token" }])).rejects.toThrow("env or file");
    });
  });

  describe("file resolver", () => {
    let tempDir: string;
    let filePath: string;
    let originalSecretsDir: string | undefined;

    beforeEach(() => {
      originalSecretsDir = process.env.SECRETS_DIR;
      tempDir = mkdtempSync(join(tmpdir(), "componode-secret-"));
      filePath = join(tempDir, "secret.txt");
      writeFileSync(filePath, "file-secret\n", "utf8");
      process.env.SECRETS_DIR = tempDir;
    });

    afterEach(() => {
      if (originalSecretsDir === undefined) delete process.env.SECRETS_DIR;
      else process.env.SECRETS_DIR = originalSecretsDir;
      try {
        unlinkSync(filePath);
        rmdirSync(tempDir);
      } catch { /* ignore */ }
    });

    it("resolves a file ref relative to SECRETS_DIR", async () => {
      const secrets = await resolveSecrets([{ key: "token", file: "secret.txt" }]);
      expect(secrets).toEqual({ token: "file-secret" });
    });

    it("rejects an absolute file path", async () => {
      await expect(resolveSecrets([{ key: "token", file: filePath }])).rejects.toThrow("SECRETS_DIR");
    });

    it("rejects a path that escapes SECRETS_DIR via ..", async () => {
      const outside = join(tmpdir(), "componode-outside-secret.txt");
      writeFileSync(outside, "outside-secret\n", "utf8");
      try {
        await expect(
          resolveSecrets([{ key: "token", file: "../componode-outside-secret.txt" }]),
        ).rejects.toThrow("SECRETS_DIR");
        await expect(
          resolveSecrets([{ key: "token", file: "../../etc/passwd" }]),
        ).rejects.toThrow("SECRETS_DIR");
      } finally {
        try { unlinkSync(outside); } catch { /* ignore */ }
      }
    });

    it("rejects a file ref naming the directory root itself", async () => {
      await expect(resolveSecrets([{ key: "token", file: "." }])).rejects.toThrow("SECRETS_DIR");
    });

    it("redacts resolved values from string output", () => {
      // This is a smoke test that the resolver object does not expose secrets in toString.
      const resolver = new EnvSecretResolver();
      expect(String(resolver)).not.toContain("secret-value");
    });
  });

  describe("credential resolution", () => {
    const keyring: Keyring = {
      current: parseMasterKey(randomBytes(32).toString("base64"), 1),
      previous: null,
    };

    function makeCredential(overrides: Partial<CredentialRecord> & { secrets: Record<string, string> }): CredentialRecord {
      const { secrets, ...rest } = overrides;
      const { encryptedPayload, keyVersion } = encryptSecrets(secrets, keyring);
      return {
        id: rest.id ?? "cred-1",
        label: rest.label ?? "Test credential",
        status: rest.status ?? "ACTIVE",
        encryptedPayload,
        keyVersion,
        expiresAt: rest.expiresAt ?? null,
      };
    }

    function depsFor(creds: CredentialRecord[]) {
      return {
        keyring,
        loadCredential: async (id: string) => creds.find((c) => c.id === id) ?? null,
      };
    }

    it("merges credential keys into the resolved secrets", async () => {
      const cred = makeCredential({ id: "c1", secrets: { token: "ghp_abc", other: "v" } });
      const result = await resolveImportSecrets({ credentialIds: ["c1"] }, depsFor([cred]));
      expect(result.secrets).toEqual({ token: "ghp_abc", other: "v" });
      expect(result.credentialIds).toEqual(["c1"]);
      expect(result.legacyRefsUsed).toBe(false);
      expect(result.warnings).toEqual([]);
    });

    it("merges credentials across multiple referenced credentials", async () => {
      const a = makeCredential({ id: "a", secrets: { token: "t" } });
      const b = makeCredential({ id: "b", secrets: { region: "us" } });
      const result = await resolveImportSecrets({ credentialIds: ["a", "b"] }, depsFor([a, b]));
      expect(result.secrets).toEqual({ token: "t", region: "us" });
    });

    it("still resolves legacy env refs and flags them deprecated", async () => {
      process.env.LEGACY_TOKEN = "legacy";
      try {
        const result = await resolveImportSecrets(
          { secretRefs: [{ key: "token", env: "LEGACY_TOKEN" }] },
          depsFor([]),
        );
        expect(result.secrets).toEqual({ token: "legacy" });
        expect(result.legacyRefsUsed).toBe(true);
      } finally {
        delete process.env.LEGACY_TOKEN;
      }
    });

    it("rejects a key collision between two credentials naming both labels", async () => {
      const a = makeCredential({ id: "a", label: "Cred A", secrets: { token: "1" } });
      const b = makeCredential({ id: "b", label: "Cred B", secrets: { token: "2" } });
      await expect(
        resolveImportSecrets({ credentialIds: ["a", "b"] }, depsFor([a, b])),
      ).rejects.toMatchObject({ code: "CREDENTIAL_KEY_COLLISION" });
      await expect(
        resolveImportSecrets({ credentialIds: ["a", "b"] }, depsFor([a, b])),
      ).rejects.toThrow(/Cred A.*Cred B|Cred B.*Cred A/);
    });

    it("rejects a key collision between a credential and a legacy ref", async () => {
      process.env.LEGACY_TOKEN = "legacy";
      const cred = makeCredential({ id: "c1", label: "Cred C", secrets: { token: "t" } });
      try {
        await expect(
          resolveImportSecrets(
            { credentialIds: ["c1"], secretRefs: [{ key: "token", env: "LEGACY_TOKEN" }] },
            depsFor([cred]),
          ),
        ).rejects.toMatchObject({ code: "CREDENTIAL_KEY_COLLISION" });
      } finally {
        delete process.env.LEGACY_TOKEN;
      }
    });

    it("fails with CREDENTIAL_NOT_FOUND for a missing credential", async () => {
      await expect(
        resolveImportSecrets({ credentialIds: ["missing"] }, depsFor([])),
      ).rejects.toMatchObject({ code: "CREDENTIAL_NOT_FOUND" });
    });

    it("fails with CREDENTIAL_REVOKED naming the credential", async () => {
      const cred = makeCredential({ id: "c1", label: "Revoked cred", status: "REVOKED", secrets: { token: "t" } });
      await expect(
        resolveImportSecrets({ credentialIds: ["c1"] }, depsFor([cred])),
      ).rejects.toMatchObject({ code: "CREDENTIAL_REVOKED", message: expect.stringContaining("Revoked cred") });
    });

    it("warns (does not fail) for a past expiresAt", async () => {
      const cred = makeCredential({
        id: "c1",
        secrets: { token: "t" },
        expiresAt: new Date(Date.now() - 86400_000).toISOString(),
      });
      const result = await resolveImportSecrets({ credentialIds: ["c1"] }, depsFor([cred]));
      expect(result.secrets.token).toBe("t");
      expect(result.warnings.length).toBe(1);
      expect(result.warnings[0]).toContain("Test credential");
    });

    it("warns for expiresAt within 14 days", async () => {
      const cred = makeCredential({
        id: "c1",
        secrets: { token: "t" },
        expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(),
      });
      const result = await resolveImportSecrets({ credentialIds: ["c1"] }, depsFor([cred]));
      expect(result.warnings.length).toBe(1);
    });

    it("does not warn for expiresAt beyond 14 days", async () => {
      const cred = makeCredential({
        id: "c1",
        secrets: { token: "t" },
        expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
      });
      const result = await resolveImportSecrets({ credentialIds: ["c1"] }, depsFor([cred]));
      expect(result.warnings).toEqual([]);
    });
  });

  describe("assertRequiredSecrets", () => {
    it("passes when all required keys are present", () => {
      expect(() =>
        assertRequiredSecrets({ token: "t" }, [{ key: "token", label: "Token", required: true }]),
      ).not.toThrow();
    });

    it("throws CREDENTIAL_MISSING_KEY for a missing required key", () => {
      expect(() =>
        assertRequiredSecrets({}, [{ key: "token", label: "Token", required: true }]),
      ).toThrowError(expect.objectContaining({ code: "CREDENTIAL_MISSING_KEY" }) as Error);
    });

    it("names the referenced credential labels in the missing-key message", () => {
      expect(() =>
        assertRequiredSecrets(
          {},
          [{ key: "token", label: "Token", required: true }],
          ["GitHub PAT"],
        ),
      ).toThrowError(/GitHub PAT/);
    });

    it("allows missing optional keys", () => {
      expect(() =>
        assertRequiredSecrets({}, [{ key: "opt", label: "Optional", required: false }]),
      ).not.toThrow();
    });
  });
});
