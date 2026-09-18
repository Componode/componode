import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// AES-256-GCM envelope encryption for stored credentials (ADR-107).
// Envelope: "v1.<keyVersion>.<nonce_b64url>.<ciphertext+tag_b64url>".
// The master key lives outside the DB (env or SECRETS_DIR/master.key);
// losing it makes all stored credentials unrecoverable.

const ENVELOPE_VERSION = "v1";
const KEY_BYTES = 32;
const NONCE_BYTES = 12;
const MASTER_KEY_FILENAME = "master.key";

export interface MasterKey {
  key: Buffer;
  version: number;
}

export interface Keyring {
  current: MasterKey;
  previous: MasterKey | null;
}

export interface EncryptResult {
  encryptedPayload: string;
  keyVersion: number;
}

export function parseMasterKey(raw: string, version: number): MasterKey {
  const trimmed = raw.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(trimmed)
    ? Buffer.from(trimmed, "hex")
    : Buffer.from(trimmed, "base64");
  if (key.length !== KEY_BYTES) {
    throw new Error(`Master key must be ${KEY_BYTES} bytes, got ${key.length}`);
  }
  return { key, version };
}

export function encryptSecrets(
  payload: Record<string, string>,
  keyring: Keyring,
): EncryptResult {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", keyring.current.key, nonce);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  const packed = Buffer.concat([ciphertext, tag]).toString("base64url");
  return {
    encryptedPayload: `${ENVELOPE_VERSION}.${keyring.current.version}.${nonce.toString("base64url")}.${packed}`,
    keyVersion: keyring.current.version,
  };
}

function keyForVersion(keyring: Keyring, version: number): MasterKey {
  if (version === keyring.current.version) return keyring.current;
  if (keyring.previous && version === keyring.previous.version) return keyring.previous;
  throw new Error(`No master key available for keyVersion ${version}`);
}

export function decryptSecrets(
  encryptedPayload: string,
  keyring: Keyring,
): Record<string, string> {
  const parts = encryptedPayload.split(".");
  if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
    throw new Error("Malformed credential envelope");
  }
  const version = Number(parts[1]);
  const nonceB64 = parts[2];
  const packedB64 = parts[3];
  if (!Number.isInteger(version) || version < 1 || !nonceB64 || !packedB64) {
    throw new Error("Malformed credential envelope: bad keyVersion");
  }
  const masterKey = keyForVersion(keyring, version);
  const nonce = Buffer.from(nonceB64, "base64url");
  const packed = Buffer.from(packedB64, "base64url");
  const ciphertext = packed.subarray(0, packed.length - 16);
  const tag = packed.subarray(packed.length - 16);
  const decipher = createDecipheriv("aes-256-gcm", masterKey.key, nonce);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as Record<string, string>;
}

// Re-encrypt under the current key when the payload was encrypted with an
// older keyVersion. Returns null when already current (or when the payload
// can't be decrypted — caller decides how to handle).
export function reencryptIfNeeded(
  encryptedPayload: string,
  keyring: Keyring,
): EncryptResult | null {
  const parts = encryptedPayload.split(".");
  if (parts.length !== 4 || parts[0] !== ENVELOPE_VERSION) {
    throw new Error("Malformed credential envelope");
  }
  if (Number(parts[1]) === keyring.current.version) return null;
  const payload = decryptSecrets(encryptedPayload, keyring);
  return encryptSecrets(payload, keyring);
}

let cachedKeyring: Keyring | null | undefined;

export function resetKeyringCache(): void {
  cachedKeyring = undefined;
}

// Bootstrap order (ADR-107 D3): COMPONODE_SECRETS_KEY env →
// SECRETS_DIR/master.key → auto-generate master.key → null (degraded).
// COMPONODE_SECRETS_KEY_PREVIOUS supplies the retiring key during rotation.
export async function loadKeyring(): Promise<Keyring | null> {
  if (cachedKeyring !== undefined) return cachedKeyring;
  cachedKeyring = await loadKeyringUncached();
  return cachedKeyring;
}

async function loadKeyringUncached(): Promise<Keyring | null> {
  const envKey = process.env.COMPONODE_SECRETS_KEY?.trim();
  const envPrevious = process.env.COMPONODE_SECRETS_KEY_PREVIOUS?.trim();
  const previous = envPrevious ? parseMasterKey(envPrevious, 1) : null;
  const currentVersion = previous ? 2 : 1;

  if (envKey) {
    return { current: parseMasterKey(envKey, currentVersion), previous };
  }

  const secretsDir = resolve(process.env.SECRETS_DIR ?? "/run/secrets");
  const keyPath = resolve(secretsDir, MASTER_KEY_FILENAME);

  try {
    const raw = await readFile(keyPath, "utf8");
    return { current: parseMasterKey(raw, currentVersion), previous };
  } catch {
    // No key file — fall through to auto-generation.
  }

  // Auto-generate only into an existing SECRETS_DIR (a real mount/dir the
  // operator provisioned). Creating the directory ourselves would write the
  // key into the container's ephemeral layer — lost on recreate.
  try {
    const generated = randomBytes(KEY_BYTES).toString("base64");
    await writeFile(keyPath, generated, { mode: 0o600, flag: "wx" });
    return { current: parseMasterKey(generated, currentVersion), previous };
  } catch {
    return null;
  }
}
