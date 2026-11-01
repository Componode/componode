import { describe, it, expect, vi } from "vitest";

vi.mock("../src/context-store.js", () => ({
  resolveDockerContext: vi.fn(() => ({ socketPath: "/from/context" })),
}));

import { buildDockerOptions } from "../src/transport.js";

describe("buildDockerOptions", () => {
  it("socket → socketPath", () => {
    expect(buildDockerOptions({ transport: "socket", path: "/var/run/docker.sock" }, {})).toEqual({
      socketPath: "/var/run/docker.sock",
    });
  });

  it("tcp → verified mTLS options; missing named secrets throw non-secret error", () => {
    const opts = buildDockerOptions(
      { transport: "tcp", host: "d.example", port: 2376, caCertKey: "caCert", clientCertKey: "cc", clientKeyKey: "ck" },
      { caCert: "CA", cc: "CERT", ck: "KEY" },
    ) as Record<string, unknown>;
    expect(opts).toMatchObject({ protocol: "https", host: "d.example", port: 2376, ca: "CA", cert: "CERT", key: "KEY" });
    // caCertKey optional
    const noCa = buildDockerOptions(
      { transport: "tcp", host: "d.example", port: 2376, clientCertKey: "cc", clientKeyKey: "ck" },
      { cc: "CERT", ck: "KEY" },
    ) as Record<string, unknown>;
    expect(noCa.ca).toBeUndefined();
    expect(() =>
      buildDockerOptions({ transport: "tcp", host: "h", port: 2376, clientCertKey: "cc", clientKeyKey: "missing" }, { cc: "C" }),
    ).toThrow(/secret key "missing"/);
  });

  it("ssh → docker system dial-stdio options with sha256 hostVerifier (hex + SHA256:base64 pins)", () => {
    const cases: Array<[pin: string, goodHash: string]> = [
      ["a".repeat(64), "a".repeat(64)],
      [`SHA256:${Buffer.from("aa", "hex").toString("base64")}`, "aa"],
    ];
    for (const [pin, goodHash] of cases) {
      const opts = buildDockerOptions(
        { transport: "ssh", host: "h", port: 22, user: "u", hostKeySha256: pin, privateKeyKey: "pk" },
        { pk: "KEY" },
      ) as Record<string, unknown>;
      expect(opts).toMatchObject({ protocol: "ssh", host: "h", port: 22, username: "u" });
      const ssh = opts.sshOptions as Record<string, unknown>;
      expect(ssh.hostHash).toBe("sha256");
      expect(ssh.privateKey).toBe("KEY");
      const hv = ssh.hostVerifier as (hash: string) => boolean;
      expect(hv(goodHash)).toBe(true);
      expect(hv("deadbeef")).toBe(false);
    }
  });

  it("ssh without passphrase omits the passphrase key", () => {
    const opts = buildDockerOptions(
      { transport: "ssh", host: "h", port: 22, user: "u", hostKeySha256: "a".repeat(64), privateKeyKey: "pk", passphraseKey: "pp" },
      { pk: "K" },
    ) as Record<string, unknown>;
    expect((opts.sshOptions as Record<string, unknown>).passphrase).toBeUndefined();
  });

  it("context delegates to the context-store resolver", () => {
    expect(buildDockerOptions({ transport: "context", name: "prod" }, {})).toEqual({ socketPath: "/from/context" });
  });
});
