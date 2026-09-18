import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { startTestDb, type TestDb } from "../helpers/testcontainers.js";
import { truncateImportTables } from "../helpers/api.js";

const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");

// Boot wiring for the credential store (spec 013 US6): key bootstrap,
// fail-when-data-without-key, degraded mode, and dual-key rotation.
describe("credential store boot", () => {
  let testDb: TestDb | null = null;
  let savedEnv: Record<string, string | undefined>;
  let secretsDir: string;

  beforeEach(async () => {
    savedEnv = {
      DATABASE_URL: process.env.DATABASE_URL,
      COMPONODE_SECRETS_KEY: process.env.COMPONODE_SECRETS_KEY,
      COMPONODE_SECRETS_KEY_PREVIOUS: process.env.COMPONODE_SECRETS_KEY_PREVIOUS,
      SECRETS_DIR: process.env.SECRETS_DIR,
    };
    testDb = await startTestDb();
    process.env.DATABASE_URL = testDb.container.getConnectionUri();
    delete process.env.COMPONODE_SECRETS_KEY;
    delete process.env.COMPONODE_SECRETS_KEY_PREVIOUS;
    secretsDir = mkdtempSync(join(tmpdir(), "cn-secrets-"));
    process.env.SECRETS_DIR = secretsDir;
    vi.resetModules();
  });

  afterEach(async () => {
    if (testDb) {
      await truncateImportTables(testDb.db);
      await testDb.cleanup();
      testDb = null;
    }
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    vi.resetModules();
  });

  const silentLog = { warn: vi.fn(), info: vi.fn() };

  async function importBoot() {
    const crypto = await import("../../src/utils/credential-crypto.js");
    crypto.resetKeyringCache();
    const boot = await import("../../src/services/credential-boot.js");
    return { ...crypto, ...boot };
  }

  it("auto-generates master.key into an existing SECRETS_DIR on first boot", async () => {
    const { bootstrapCredentialStore } = await importBoot();
    const result = await bootstrapCredentialStore(silentLog);
    expect(result.keyring).not.toBeNull();

    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(join(secretsDir, "master.key"), "utf8");
    expect(raw.trim().length).toBeGreaterThan(0);
  });

  it("runs degraded (no keyring) when the store is empty and no key source exists", async () => {
    process.env.SECRETS_DIR = join(tmpdir(), "cn-nonexistent-dir");
    const { bootstrapCredentialStore } = await importBoot();
    const result = await bootstrapCredentialStore(silentLog);
    expect(result.keyring).toBeNull();
    expect(silentLog.warn).toHaveBeenCalled();
  });

  it("refuses to boot when credentials exist but no key is configured", async () => {
    // Seed a credential under KEY_A, then remove all key sources.
    process.env.COMPONODE_SECRETS_KEY = KEY_A;
    const first = await importBoot();
    const { createCredential } = await import("../../src/services/credential-service.js");
    await createCredential(
      { label: "PAT", secrets: { token: "ghp_boot" } },
      { id: null, name: "test" },
    );

    delete process.env.COMPONODE_SECRETS_KEY;
    process.env.SECRETS_DIR = join(tmpdir(), "cn-nonexistent-dir");
    const second = await importBoot();
    await expect(second.bootstrapCredentialStore(silentLog)).rejects.toThrow(/master key/);
  });

  it("dual-key rotation re-encrypts payloads and bumps keyVersion", async () => {
    process.env.COMPONODE_SECRETS_KEY = KEY_A;
    const first = await importBoot();
    const { createCredential } = await import("../../src/services/credential-service.js");
    const cred = await createCredential(
      { label: "PAT", secrets: { token: "ghp_rotate_me" } },
      { id: null, name: "test" },
    );

    // Rotate: KEY_B becomes current (v2), KEY_A becomes previous (v1).
    process.env.COMPONODE_SECRETS_KEY = KEY_B;
    process.env.COMPONODE_SECRETS_KEY_PREVIOUS = KEY_A;
    const second = await importBoot();
    const result = await second.bootstrapCredentialStore(silentLog);
    expect(result.rotated).toBe(1);
    expect(result.keyring?.current.version).toBe(2);

    const row = await testDb!.db
      .selectFrom("credentials")
      .selectAll()
      .where("id", "=", cred.id)
      .executeTakeFirstOrThrow();
    expect(row.keyVersion).toBe(2);
    expect(second.decryptSecrets(row.encryptedPayload, result.keyring!)).toEqual({
      token: "ghp_rotate_me",
    });
  });
});
