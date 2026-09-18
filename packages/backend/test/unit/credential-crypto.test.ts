import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import {
  encryptSecrets,
  decryptSecrets,
  parseMasterKey,
  loadKeyring,
  reencryptIfNeeded,
  resetKeyringCache,
  type Keyring,
} from "../../src/utils/credential-crypto.js";

const KEY_A_B64 = randomBytes(32).toString("base64");
const KEY_B_B64 = randomBytes(32).toString("base64");

function makeKeyring(currentB64 = KEY_A_B64, previousB64?: string): Keyring {
  return {
    current: parseMasterKey(currentB64, previousB64 ? 2 : 1),
    previous: previousB64 ? parseMasterKey(previousB64, 1) : null,
  };
}

describe("credential crypto", () => {
  describe("encrypt/decrypt round-trip", () => {
    it("encrypts and decrypts a payload", () => {
      const keyring = makeKeyring();
      const payload = { token: "ghp_secret123", extra: "value" };
      const { encryptedPayload, keyVersion } = encryptSecrets(payload, keyring);
      expect(keyVersion).toBe(1);
      expect(encryptedPayload).not.toContain("ghp_secret123");
      expect(decryptSecrets(encryptedPayload, keyring)).toEqual(payload);
    });

    it("produces different ciphertext for the same payload (random nonce)", () => {
      const keyring = makeKeyring();
      const payload = { token: "same" };
      const a = encryptSecrets(payload, keyring);
      const b = encryptSecrets(payload, keyring);
      expect(a.encryptedPayload).not.toBe(b.encryptedPayload);
    });

    it("uses the v1 envelope format", () => {
      const { encryptedPayload } = encryptSecrets({ k: "v" }, makeKeyring());
      expect(encryptedPayload.startsWith("v1.")).toBe(true);
      expect(encryptedPayload.split(".")).toHaveLength(4);
    });
  });

  describe("integrity and wrong-key behavior", () => {
    it("fails decryption when ciphertext is tampered", () => {
      const keyring = makeKeyring();
      const { encryptedPayload } = encryptSecrets({ token: "x" }, keyring);
      const parts = encryptedPayload.split(".");
      const raw = Buffer.from(parts[3], "base64url");
      raw[0] ^= 0xff;
      parts[3] = raw.toString("base64url");
      expect(() => decryptSecrets(parts.join("."), keyring)).toThrow();
    });

    it("fails decryption with a different key", () => {
      const { encryptedPayload } = encryptSecrets({ token: "x" }, makeKeyring());
      expect(() => decryptSecrets(encryptedPayload, makeKeyring(KEY_B_B64))).toThrow();
    });

    it("rejects a malformed envelope", () => {
      expect(() => decryptSecrets("not-an-envelope", makeKeyring())).toThrow();
    });
  });

  describe("key versions", () => {
    it("decrypts payloads encrypted under a previous key", () => {
      const oldKeyring = makeKeyring(KEY_A_B64);
      const { encryptedPayload } = encryptSecrets({ token: "x" }, oldKeyring);
      const rotated = makeKeyring(KEY_B_B64, KEY_A_B64);
      expect(decryptSecrets(encryptedPayload, rotated)).toEqual({ token: "x" });
    });

    it("re-encrypts stale payloads under the current key", () => {
      const oldKeyring = makeKeyring(KEY_A_B64);
      const { encryptedPayload } = encryptSecrets({ token: "x" }, oldKeyring);
      const rotated = makeKeyring(KEY_B_B64, KEY_A_B64);
      const result = reencryptIfNeeded(encryptedPayload, rotated);
      expect(result).not.toBeNull();
      expect(result!.keyVersion).toBe(2);
      expect(decryptSecrets(result!.encryptedPayload, rotated)).toEqual({ token: "x" });
    });

    it("returns null when the payload is already current", () => {
      const rotated = makeKeyring(KEY_B_B64, KEY_A_B64);
      const { encryptedPayload } = encryptSecrets({ t: "x" }, rotated);
      expect(reencryptIfNeeded(encryptedPayload, rotated)).toBeNull();
    });
  });

  describe("parseMasterKey", () => {
    it("accepts base64 and hex encodings of 32 bytes", () => {
      const raw = randomBytes(32);
      expect(parseMasterKey(raw.toString("base64"), 1).key).toEqual(raw);
      expect(parseMasterKey(raw.toString("hex"), 1).key).toEqual(raw);
    });

    it("rejects wrong lengths", () => {
      expect(() => parseMasterKey(randomBytes(16).toString("base64"), 1)).toThrow("32");
      expect(() => parseMasterKey("short", 1)).toThrow();
    });
  });

  describe("loadKeyring bootstrap", () => {
    let tempDir: string;
    let saved: Record<string, string | undefined>;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), "componode-keyring-"));
      saved = {
        COMPONODE_SECRETS_KEY: process.env.COMPONODE_SECRETS_KEY,
        COMPONODE_SECRETS_KEY_PREVIOUS: process.env.COMPONODE_SECRETS_KEY_PREVIOUS,
        SECRETS_DIR: process.env.SECRETS_DIR,
      };
      delete process.env.COMPONODE_SECRETS_KEY;
      delete process.env.COMPONODE_SECRETS_KEY_PREVIOUS;
      process.env.SECRETS_DIR = tempDir;
      resetKeyringCache();
    });

    afterEach(() => {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      resetKeyringCache();
      rmSync(tempDir, { recursive: true, force: true });
    });

    it("prefers the env key over a file", async () => {
      writeFileSync(join(tempDir, "master.key"), KEY_B_B64);
      process.env.COMPONODE_SECRETS_KEY = KEY_A_B64;
      const keyring = await loadKeyring();
      const { encryptedPayload } = encryptSecrets({ t: "x" }, keyring!);
      expect(decryptSecrets(encryptedPayload, makeKeyring())).toEqual({ t: "x" });
    });

    it("loads the key from SECRETS_DIR/master.key when env is unset", async () => {
      writeFileSync(join(tempDir, "master.key"), KEY_A_B64);
      const keyring = await loadKeyring();
      expect(keyring).not.toBeNull();
      const { encryptedPayload } = encryptSecrets({ t: "x" }, keyring!);
      expect(decryptSecrets(encryptedPayload, keyring!)).toEqual({ t: "x" });
    });

    it("auto-generates master.key on first boot when nothing is configured", async () => {
      const keyring = await loadKeyring();
      expect(keyring).not.toBeNull();
      const keyFile = join(tempDir, "master.key");
      expect(existsSync(keyFile)).toBe(true);
      const persisted = parseMasterKey(readFileSync(keyFile, "utf8").trim(), 1);
      expect(persisted.key).toHaveLength(32);
    });

    it("returns null when no key exists and SECRETS_DIR is not writable", async () => {
      process.env.SECRETS_DIR = join(tempDir, "does-not-exist", "deeper");
      expect(await loadKeyring()).toBeNull();
    });

    it("exposes the previous key when COMPONODE_SECRETS_KEY_PREVIOUS is set", async () => {
      process.env.COMPONODE_SECRETS_KEY = KEY_B_B64;
      process.env.COMPONODE_SECRETS_KEY_PREVIOUS = KEY_A_B64;
      const keyring = await loadKeyring();
      expect(keyring!.previous).not.toBeNull();
      expect(keyring!.current.version).toBe(2);
    });
  });
});
