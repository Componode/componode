import { describe, it, expect, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";

vi.mock("../../src/db/connection.js", () => ({ db: {} }));
vi.mock("../../src/services/importer-registry.js", () => ({
  getManifest: async () => ({ targetProfileSchema: {} }),
  getImporter: async () => ({}),
}));
vi.mock("../../src/services/audit-service.js", () => ({
  writeEntityChange: async () => {},
}));
vi.mock("../../src/utils/credential-crypto.js", () => ({
  decryptSecrets: () => ({}),
  loadKeyring: async () => null,
}));

const { profileSecretKeys } = await import(
  "../../src/services/docker-target-service.js"
);
const {
  createDockerTargetSchema,
  updateDockerTargetSchema,
  testDockerTargetSchema,
} = await import("@componode/core");

describe("profileSecretKeys", () => {
  it("extracts *Key field names → credential key names", () => {
    expect(
      profileSecretKeys({
        transport: "tcp",
        host: "docker.example.com",
        port: 2376,
        caCertKey: "caCert",
        clientCertKey: "clientCert",
        clientKeyKey: "clientKey",
      }),
    ).toEqual(["caCert", "clientCert", "clientKey"]);
  });

  it("returns empty for secret-free profiles", () => {
    expect(profileSecretKeys({ transport: "socket", path: "/var/run/docker.sock" })).toEqual([]);
    expect(profileSecretKeys({ transport: "context", name: "prod" })).toEqual([]);
  });

  it("ignores non-string and empty *Key values", () => {
    expect(
      profileSecretKeys({ transport: "tcp", clientCertKey: "", clientKeyKey: "k", other: "v" }),
    ).toEqual(["k"]);
  });
});

describe("docker target route schemas", () => {
  it("create accepts a valid socket target", () => {
    const r = createDockerTargetSchema.safeParse({
      targetId: "prod-1",
      label: "Prod",
      profile: { transport: "socket", path: "/var/run/docker.sock" },
    });
    expect(r.success).toBe(true);
  });

  it("create rejects empty targetId and unknown keys", () => {
    expect(
      createDockerTargetSchema.safeParse({ targetId: "", label: "x", profile: {} }).success,
    ).toBe(false);
    expect(
      createDockerTargetSchema.safeParse({
        targetId: "x",
        label: "x",
        profile: {},
        host: "sneaky",
      }).success,
    ).toBe(false);
  });

  it("update accepts only label/description", () => {
    expect(updateDockerTargetSchema.safeParse({ label: "x" }).success).toBe(true);
    expect(updateDockerTargetSchema.safeParse({ description: null }).success).toBe(true);
    expect(updateDockerTargetSchema.safeParse({ targetId: "y" }).success).toBe(false);
    expect(updateDockerTargetSchema.safeParse({ profile: {} }).success).toBe(false);
  });

  it("test accepts empty body and configId", () => {
    expect(testDockerTargetSchema.safeParse({}).success).toBe(true);
    expect(
      testDockerTargetSchema.safeParse({ configId: "123e4567-e89b-42d3-a456-426614174000" }).success,
    ).toBe(true);
    expect(testDockerTargetSchema.safeParse({ configId: "nope" }).success).toBe(false);
  });
});
