import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { EnvSecretResolver, resolveSecretsFromMap } from "../../src/utils/secrets.js";
import { writeFileSync, mkdirSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("shared secret resolver", () => {
  describe("env resolution", () => {
    beforeEach(() => {
      process.env.CORE_TEST_SECRET = "env-value";
    });
    afterEach(() => {
      delete process.env.CORE_TEST_SECRET;
    });

    it("resolves an env ref", async () => {
      await expect(new EnvSecretResolver().resolve({ env: "CORE_TEST_SECRET" })).resolves.toBe("env-value");
    });

    it("rejects a missing env var", async () => {
      await expect(new EnvSecretResolver().resolve({ env: "CORE_TEST_MISSING" })).rejects.toThrow("CORE_TEST_MISSING");
    });

    it("reads env at resolve time — nothing is cached at construction", async () => {
      const r = new EnvSecretResolver();
      process.env.CORE_TEST_LATE = "set-after-construction";
      try {
        await expect(r.resolve({ env: "CORE_TEST_LATE" })).resolves.toBe("set-after-construction");
        process.env.CORE_TEST_LATE = "rotated";
        await expect(r.resolve({ env: "CORE_TEST_LATE" })).resolves.toBe("rotated");
      } finally {
        delete process.env.CORE_TEST_LATE;
      }
    });
  });

  describe("file resolution", () => {
    let secretsDir: string;

    beforeEach(() => {
      secretsDir = mkdtempSync(join(tmpdir(), "componode-core-secrets-"));
      writeFileSync(join(secretsDir, "secret.txt"), "  file-value\n", "utf8");
      mkdirSync(join(secretsDir, "nested"));
      writeFileSync(join(secretsDir, "nested", "inner.txt"), "nested-value", "utf8");
    });
    afterEach(() => {
      rmSync(secretsDir, { recursive: true, force: true });
    });

    it("resolves a file under secretsDir and trims contents", async () => {
      const r = new EnvSecretResolver(secretsDir);
      await expect(r.resolve({ file: "secret.txt" })).resolves.toBe("file-value");
    });

    it("resolves a nested relative path", async () => {
      const r = new EnvSecretResolver(secretsDir);
      await expect(r.resolve({ file: "nested/inner.txt" })).resolves.toBe("nested-value");
    });

    it("rejects absolute paths", async () => {
      const r = new EnvSecretResolver(secretsDir);
      await expect(r.resolve({ file: join(secretsDir, "secret.txt") })).rejects.toThrow("relative");
    });

    it("rejects traversal outside secretsDir", async () => {
      const r = new EnvSecretResolver(secretsDir);
      await expect(r.resolve({ file: "../escape.txt" })).rejects.toThrow("escapes");
    });

    it("defaults secretsDir to /run/secrets", async () => {
      const prev = process.env.SECRETS_DIR;
      delete process.env.SECRETS_DIR;
      try {
        await expect(new EnvSecretResolver().resolve({ file: "x" })).rejects.toThrow();
      } finally {
        if (prev !== undefined) process.env.SECRETS_DIR = prev;
      }
    });

    it("honors the SECRETS_DIR env var", async () => {
      const prev = process.env.SECRETS_DIR;
      process.env.SECRETS_DIR = secretsDir;
      try {
        await expect(new EnvSecretResolver().resolve({ file: "secret.txt" })).resolves.toBe("file-value");
      } finally {
        if (prev === undefined) delete process.env.SECRETS_DIR;
        else process.env.SECRETS_DIR = prev;
      }
    });
  });

  describe("resolveSecretsFromMap", () => {
    it("resolves every entry and returns the resolved map", async () => {
      process.env.CORE_TEST_A = "a";
      process.env.CORE_TEST_B = "b";
      try {
        const resolved = await resolveSecretsFromMap(
          { token: { env: "CORE_TEST_A" }, other: { env: "CORE_TEST_B" } },
          new EnvSecretResolver(),
        );
        expect(resolved).toEqual({ token: "a", other: "b" });
      } finally {
        delete process.env.CORE_TEST_A;
        delete process.env.CORE_TEST_B;
      }
    });

    it("fails the whole map when one ref is unresolvable", async () => {
      process.env.CORE_TEST_A = "a";
      try {
        await expect(
          resolveSecretsFromMap(
            { token: { env: "CORE_TEST_A" }, missing: { env: "CORE_TEST_MISSING" } },
            new EnvSecretResolver(),
          ),
        ).rejects.toThrow("CORE_TEST_MISSING");
      } finally {
        delete process.env.CORE_TEST_A;
      }
    });
  });
});
