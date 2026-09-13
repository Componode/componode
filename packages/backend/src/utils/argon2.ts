import { hash, verify } from "@node-rs/argon2";

// Algorithm.Argon2id = 2 (cannot use const enum with verbatimModuleSyntax)
const ARGON2ID = 2;

const argon2Config = {
  algorithm: ARGON2ID,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, argon2Config);
}

export async function verifyPassword(plain: string, hashStr: string): Promise<boolean> {
  try {
    return await verify(hashStr, plain);
  } catch {
    return false;
  }
}

// Lazily computed Argon2id hash used to equalize login response timing when
// the username does not exist (or has no password). Without it, the
// missing-user path returns before hashing, leaking account existence.
let dummyPasswordHash: string | null = null;

export async function verifyAgainstDummyHash(plain: string): Promise<void> {
  if (!dummyPasswordHash) {
    dummyPasswordHash = await hashPassword("componode-timing-equalizer");
  }
  await verifyPassword(plain, dummyPasswordHash);
}
