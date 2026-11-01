import type Docker from "dockerode";
import type { DockerTargetProfile } from "./target-profile.js";
import { resolveDockerContext } from "./context-store.js";

export type DockerOptions = Docker.DockerOptions;

/** Normalize an OpenSSH `SHA256:<base64>` pin to raw bytes for compare. */
function pinBytes(pin: string): Buffer {
  if (pin.startsWith("SHA256:")) {
    return Buffer.from(pin.slice("SHA256:".length), "base64");
  }
  if (/^[0-9a-fA-F]{64}$/.test(pin)) {
    return Buffer.from(pin, "hex");
  }
  throw new Error("hostKeySha256 must be a 64-hex digest or SHA256:<base64>");
}

function requiredSecret(secrets: Record<string, string>, key: string): string {
  const value = secrets[key];
  if (!value) {
    throw new Error(`target profile requires secret key "${key}"`);
  }
  return value;
}

/**
 * Build dockerode connection options for a typed profile (ADR-121).
 * Fail-closed: no plaintext TCP, no TLS skip-verify, no password-only
 * SSH — profiles carrying those cannot validate. `ssh` uses
 * docker-modem's built-in `docker system dial-stdio` agent with a
 * SHA-256 host-key pin enforced through ssh2's hostVerifier.
 */
export function buildDockerOptions(
  profile: DockerTargetProfile,
  secrets: Record<string, string>,
): DockerOptions {
  switch (profile.transport) {
    case "socket":
      return { socketPath: profile.path };
    case "tcp": {
      const opts: Record<string, unknown> = {
        protocol: "https",
        host: profile.host,
        port: profile.port,
        cert: requiredSecret(secrets, profile.clientCertKey),
        key: requiredSecret(secrets, profile.clientKeyKey),
      };
      if (profile.caCertKey) {
        opts.ca = requiredSecret(secrets, profile.caCertKey);
      }
      return opts as DockerOptions;
    }
    case "ssh": {
      const expected = pinBytes(profile.hostKeySha256);
      const sshOptions: Record<string, unknown> = {
        privateKey: requiredSecret(secrets, profile.privateKeyKey),
        hostHash: "sha256",
        hostVerifier: (hash: string) =>
          Buffer.from(hash, "hex").equals(expected),
      };
      if (profile.passphraseKey && secrets[profile.passphraseKey]) {
        sshOptions.passphrase = secrets[profile.passphraseKey];
      }
      return {
        protocol: "ssh",
        host: profile.host,
        port: profile.port,
        username: profile.user,
        sshOptions,
      } as DockerOptions;
    }
    case "context":
      return resolveDockerContext(profile.name);
  }
}
