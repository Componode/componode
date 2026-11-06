import { describe, it, expect } from "vitest";
import {
  DOCKER_SETUP_TRANSPORTS,
  TRANSPORT_SECRET_KEYS,
  buildTargetProfile,
  credentialCoversKeys,
  slugify,
  suggestTargetId,
  transportSecretKeys,
} from "@/ux/components/importers/docker-setup-logic";

describe("docker-setup-logic", () => {
  it("maps canonical secret keys per transport", () => {
    expect(TRANSPORT_SECRET_KEYS.socket).toEqual({ required: [], optional: [] });
    expect(TRANSPORT_SECRET_KEYS.context).toEqual({ required: [], optional: [] });
    expect(TRANSPORT_SECRET_KEYS.tcp).toEqual({ required: ["clientCert", "clientKey"], optional: ["caCert"] });
    expect(TRANSPORT_SECRET_KEYS.ssh).toEqual({ required: ["sshPrivateKey"], optional: ["sshPassphrase"] });
    expect(transportSecretKeys("tcp")).toEqual(["clientCert", "clientKey", "caCert"]);
  });

  it("socket profile contains only transport + path", () => {
    const p = buildTargetProfile("socket", { path: "/var/run/docker.sock" });
    expect(p).toEqual({ transport: "socket", path: "/var/run/docker.sock" });
  });

  it("returns null when a required route field is missing", () => {
    expect(buildTargetProfile("socket", {})).toBeNull();
    expect(buildTargetProfile("tcp", { host: "h" })).toBeNull(); // port required
  });

  it("tcp profile derives *Key refs only for provided secrets", () => {
    const fields = { host: "engine.example.com", port: "2376" };
    const full = buildTargetProfile("tcp", fields, ["clientCert", "clientKey", "caCert"]);
    expect(full).toEqual({
      transport: "tcp",
      host: "engine.example.com",
      port: 2376,
      caCertKey: "caCert",
      clientCertKey: "clientCert",
      clientKeyKey: "clientKey",
    });
    const noCa = buildTargetProfile("tcp", fields, ["clientCert", "clientKey"]);
    expect(noCa).toEqual({
      transport: "tcp",
      host: "engine.example.com",
      port: 2376,
      clientCertKey: "clientCert",
      clientKeyKey: "clientKey",
    });
    expect(noCa).not.toHaveProperty("caCertKey");
  });

  it("ssh profile derives privateKeyKey always and passphraseKey only when provided", () => {
    const fields = { host: "h", user: "docker", hostKeySha256: "SHA256:abc" };
    const p = buildTargetProfile("ssh", fields, ["sshPrivateKey"]);
    expect(p).toMatchObject({ transport: "ssh", privateKeyKey: "sshPrivateKey", hostKeySha256: "SHA256:abc" });
    expect(p).not.toHaveProperty("passphraseKey");
    const withPass = buildTargetProfile("ssh", fields, ["sshPrivateKey", "sshPassphrase"]);
    expect(withPass).toMatchObject({ passphraseKey: "sshPassphrase" });
  });

  it("ignores secret keys that do not belong to the transport", () => {
    const p = buildTargetProfile("ssh", { host: "h", user: "u", hostKeySha256: "x" }, ["clientCert"]);
    expect(p).not.toHaveProperty("clientCertKey");
  });

  it("context profile uses the context name", () => {
    expect(buildTargetProfile("context", { name: "remote-prod" })).toEqual({
      transport: "context",
      name: "remote-prod",
    });
  });

  it("slugify produces docker-target-friendly selectors", () => {
    expect(slugify("Prod Docker Engine!")).toBe("prod-docker-engine");
    expect(slugify("  --Weird__Name--  ")).toBe("weird-name");
    expect(slugify("")).toBe("");
  });

  it("suggestTargetId prefers the label, falls back to host", () => {
    expect(suggestTargetId("Production Docker", "engine.example.com")).toBe("production-docker");
    expect(suggestTargetId("", "Engine.Example.COM")).toBe("engine-example-com");
    expect(suggestTargetId("", "")).toBe("docker-engine");
  });

  it("credentialCoversKeys requires every canonical key present", () => {
    expect(credentialCoversKeys({ clientCert: "a", clientKey: "b", caCert: "c" }, ["clientCert", "clientKey"])).toBe(true);
    expect(credentialCoversKeys({ clientCert: "a" }, ["clientCert", "clientKey"])).toBe(false);
    expect(credentialCoversKeys(undefined, ["clientCert"])).toBe(false);
    expect(credentialCoversKeys({}, [])).toBe(true);
  });

  it("exposes all four transports with guidance", () => {
    expect(DOCKER_SETUP_TRANSPORTS.map((t) => t.value)).toEqual(["socket", "tcp", "ssh", "context"]);
    expect(DOCKER_SETUP_TRANSPORTS.find((t) => t.value === "socket")?.guidance).toMatch(/socket/i);
  });
});
