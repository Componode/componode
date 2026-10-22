import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  EnvSecretResolver,
  SecretRefError,
  SecretResolutionError,
  maskSecretValues,
  refSource,
  resolveSecretsFromMap,
} from "../../src/utils/secrets.js";
import { writeFileSync, mkdirSync, rmSync, mkdtempSync, symlinkSync } from "node:fs";
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

    it("throws a typed SecretRefError (ENV_NOT_SET)", async () => {
      await expect(
        new EnvSecretResolver().resolve({ env: "CORE_TEST_MISSING" }),
      ).rejects.toMatchObject({ name: "SecretRefError", code: "ENV_NOT_SET" });
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

    it("rejects a symlink inside secretsDir pointing outside it (realpath confinement)", async () => {
      const outside = mkdtempSync(join(tmpdir(), "componode-outside-"));
      writeFileSync(join(outside, "hidden.txt"), "outside-value", "utf8");
      try {
        // Junction works unprivileged on Windows; symlink elsewhere.
        const linkPath = join(secretsDir, "linked");
        try {
          symlinkSync(outside, linkPath, process.platform === "win32" ? "junction" : "dir");
        } catch (err) {
          if ((err as NodeJS.ErrnoException).code === "EPERM") return; // no symlink privilege — skip
          throw err;
        }
        const r = new EnvSecretResolver(secretsDir);
        await expect(r.resolve({ file: "linked/hidden.txt" })).rejects.toMatchObject({
          name: "SecretRefError",
          code: "FILE_ESCAPES_DIR",
        });
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });

    it("rejects an unreadable/missing file with FILE_NOT_READABLE, naming the ref not the path", async () => {
      const r = new EnvSecretResolver(secretsDir);
      await expect(r.resolve({ file: "nope.txt" })).rejects.toMatchObject({
        name: "SecretRefError",
        code: "FILE_NOT_READABLE",
        message: expect.stringContaining('"nope.txt"'),
      });
      await expect(r.resolve({ file: "nope.txt" })).rejects.not.toThrow(secretsDir);
    });

    it("rejects a directory ref with FILE_NOT_READABLE — no raw fs path in the message", async () => {
      const r = new EnvSecretResolver(secretsDir);
      // "nested" exists (realpath passes) but readFile on a directory fails
      // with a raw error whose message embeds the absolute path (EISDIR).
      const err = await r.resolve({ file: "nested" }).then(
        () => { throw new Error("expected rejection"); },
        (e) => e as Error,
      );
      expect(err).toMatchObject({ name: "SecretRefError", code: "FILE_NOT_READABLE" });
      expect(err.message).toContain('"nested"');
      expect(err.message).not.toContain(secretsDir);
      expect(err.message).not.toMatch(/[A-Za-z]:[\\/]/); // no absolute path
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

    it("names the failing key and source type in SecretResolutionError", async () => {
      await expect(
        resolveSecretsFromMap(
          { token: { env: "CORE_TEST_MISSING" } },
          new EnvSecretResolver(),
        ),
      ).rejects.toMatchObject({
        name: "SecretResolutionError",
        key: "token",
        source: "env",
      });
      await expect(
        resolveSecretsFromMap(
          { pem: { file: "../escape" } },
          new EnvSecretResolver(),
        ),
      ).rejects.toMatchObject({
        name: "SecretResolutionError",
        key: "pem",
        source: "file",
      });
    });

    it("fires onResolved per key with the source type", async () => {
      process.env.CORE_TEST_A = "a";
      process.env.CORE_TEST_B = "b";
      const seen: Array<[string, string]> = [];
      try {
        await resolveSecretsFromMap(
          { token: { env: "CORE_TEST_A" }, other: { env: "CORE_TEST_B" } },
          new EnvSecretResolver(),
          (key, source) => seen.push([key, source]),
        );
        expect(seen).toEqual([
          ["token", "env"],
          ["other", "env"],
        ]);
      } finally {
        delete process.env.CORE_TEST_A;
        delete process.env.CORE_TEST_B;
      }
    });
  });

  describe("refSource", () => {
    it("reports env or file", () => {
      expect(refSource({ env: "X" })).toBe("env");
      expect(refSource({ file: "y" })).toBe("file");
    });
  });

  describe("maskSecretValues", () => {
    it("masks every resolved value inside arbitrary text", () => {
      const text = "auth failed: token=abc123 retry with abc123; detail stays";
      expect(maskSecretValues(text, { token: "abc123" })).toBe(
        "auth failed: token=*** retry with ***; detail stays",
      );
      expect(
        maskSecretValues(text, { token: "abc123", other: "zzz" }),
      ).toBe("auth failed: token=*** retry with ***; detail stays");
      expect(maskSecretValues(text, {})).toBe(text);
      expect(maskSecretValues(text, { empty: "" })).toBe(text);
    });
  });
});
