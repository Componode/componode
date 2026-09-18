import { db } from "../db/connection.js";
import {
  loadKeyring,
  reencryptIfNeeded,
  type Keyring,
} from "../utils/credential-crypto.js";

export interface CredentialBootResult {
  keyring: Keyring | null;
  // Rows re-encrypted under the current key during dual-key rotation.
  rotated: number;
}

export interface BootLog {
  warn: (msg: string) => void;
  info: (msg: string) => void;
}

// Boot wiring for the credential store (spec 013 US6, ADR-107):
//  - No key + stored credentials → fatal: the data is unreadable and silently
//    generating a new key would make it permanently unrecoverable.
//  - No key + empty store → degraded: the app runs, credential features
//    report unavailable (CREDENTIAL_KEY_UNAVAILABLE at the API, flag on
//    /api/v1/health) until a key is configured.
//  - Dual-key env (COMPONODE_SECRETS_KEY + _PREVIOUS) → re-encrypt every
//    payload stored under the old version, then the previous key can retire.
export async function bootstrapCredentialStore(
  log: BootLog,
): Promise<CredentialBootResult> {
  const keyring = await loadKeyring();

  if (!keyring) {
    const count = await db
      .selectFrom("credentials")
      .select(({ fn }) => fn.countAll<number>().as("c"))
      .executeTakeFirstOrThrow();
    if (Number(count.c) > 0) {
      throw new Error(
        "Credential store contains data but no master key is configured " +
          "(set COMPONODE_SECRETS_KEY or mount SECRETS_DIR/master.key) — " +
          "refusing to start because the stored credentials are unreadable",
      );
    }
    log.warn(
      "No credential master key configured — credential store is degraded " +
        "(set COMPONODE_SECRETS_KEY or mount SECRETS_DIR/master.key to enable it)",
    );
    return { keyring: null, rotated: 0 };
  }

  const stale = await db
    .selectFrom("credentials")
    .select(["id", "encryptedPayload"])
    .where("keyVersion", "<>", keyring.current.version)
    .execute();

  let rotated = 0;
  for (const row of stale) {
    const next = reencryptIfNeeded(row.encryptedPayload, keyring);
    if (!next) continue;
    await db
      .updateTable("credentials")
      .set({
        encryptedPayload: next.encryptedPayload,
        keyVersion: next.keyVersion,
      })
      .where("id", "=", row.id)
      .execute();
    rotated++;
  }
  if (rotated > 0) {
    log.info(`Re-encrypted ${rotated} credential(s) under the current master key`);
  }

  return { keyring, rotated };
}
