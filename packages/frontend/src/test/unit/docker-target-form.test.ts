import { describe, it, expect } from "vitest";
import {
  dockerFormErrors,
  dockerProfileFrom,
  emptyDockerTargetForm,
} from "@/ux/components/admin/docker-target-form";

describe("docker-target-form helpers", () => {
  it("builds a socket profile", () => {
    const v = { ...emptyDockerTargetForm(), fields: { path: "/var/run/docker.sock" } };
    expect(dockerProfileFrom(v)).toEqual({ transport: "socket", path: "/var/run/docker.sock" });
  });

  it("builds a tcp profile with numeric port and omits empty optionals", () => {
    const v = {
      ...emptyDockerTargetForm(),
      transport: "tcp" as const,
      fields: { host: "h", port: "2376", caCertKey: "", clientCertKey: "cc", clientKeyKey: "ck" },
    };
    expect(dockerProfileFrom(v)).toEqual({
      transport: "tcp",
      host: "h",
      port: 2376,
      clientCertKey: "cc",
      clientKeyKey: "ck",
    });
  });

  it("flags required fields per transport", () => {
    const v = { ...emptyDockerTargetForm(), transport: "ssh" as const };
    const e = dockerFormErrors(v);
    expect(e.targetId).toBeTruthy();
    expect(e.label).toBeTruthy();
    expect(e["profile.host"]).toBeTruthy();
    expect(e["profile.hostKeySha256"]).toBeTruthy();
    expect(e["profile.privateKeyKey"]).toBeTruthy();
    expect(e["profile.passphraseKey"]).toBeUndefined();
  });

  it("rejects non-numeric port", () => {
    const v = { ...emptyDockerTargetForm(), transport: "tcp" as const, fields: { port: "abc" } };
    expect(dockerFormErrors(v)["profile.port"]).toBeTruthy();
  });
});
