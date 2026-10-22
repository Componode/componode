import { describe, it, expect } from "vitest";
import {
  createCredentialSchema,
  updateCredentialSchema,
  secretRefSchema,
  secretRefMapSchema,
  testCredentialSchema,
} from "../../src/schemas/credential.js";
import {
  agentMessageSchemas,
  credentialTestPayloadSchema,
} from "../../src/contracts/agent-protocol.js";

describe("credential schemas", () => {
  it("defaults kind to STORED when absent (backward compatible)", () => {
    const parsed = createCredentialSchema.parse({
      label: "Legacy",
      secrets: { token: "v" },
    });
    expect(parsed.kind).toBe("STORED");
  });

  it("accepts an explicit STORED create", () => {
    const parsed = createCredentialSchema.parse({
      kind: "STORED",
      label: "Stored",
      secrets: { token: "v" },
    });
    expect(parsed.kind).toBe("STORED");
  });

  it("accepts an AGENT_MANAGED create with env and file refs", () => {
    const parsed = createCredentialSchema.parse({
      kind: "AGENT_MANAGED",
      label: "Agent",
      secretRefMap: { token: { env: "GH_TOKEN" }, secret: { file: "gh-secret" } },
    });
    expect(parsed.kind).toBe("AGENT_MANAGED");
    expect(parsed).not.toHaveProperty("secrets");
  });

  it("rejects a ref with both env and file", () => {
    expect(
      createCredentialSchema.safeParse({
        kind: "AGENT_MANAGED",
        label: "x",
        secretRefMap: { k: { env: "E", file: "f" } },
      }).success,
    ).toBe(false);
  });

  it("rejects a ref with an unknown source type", () => {
    expect(
      createCredentialSchema.safeParse({
        kind: "AGENT_MANAGED",
        label: "x",
        secretRefMap: { k: { vault: "path" } },
      }).success,
    ).toBe(false);
  });

  it("rejects invalid secret key names in secretRefMap", () => {
    expect(secretRefMapSchema.safeParse({ "9bad": { env: "E" } }).success).toBe(false);
    expect(secretRefMapSchema.safeParse({ "has space": { env: "E" } }).success).toBe(false);
  });

  it("rejects an empty secretRefMap", () => {
    expect(secretRefMapSchema.safeParse({}).success).toBe(false);
  });

  it("accepts a bare env ref and bare file ref", () => {
    expect(secretRefSchema.safeParse({ env: "E" }).success).toBe(true);
    expect(secretRefSchema.safeParse({ file: "f" }).success).toBe(true);
    expect(secretRefSchema.safeParse({ file: "nested/dir/gh-secret" }).success)
      .toBe(true);
  });

  // Write-time confinement (T061): permanently-unusable file refs are
  // rejected at save, not only at resolution on the agent.
  it("rejects absolute and traversal file refs", () => {
    for (const bad of [
      "/etc/passwd",
      "\\windows\\system32",
      "C:/secrets/x",
      "C:\\secrets\\x",
      "../escape",
      "nested/../../escape",
      "nested\\..\\escape",
    ]) {
      expect(
        secretRefSchema.safeParse({ file: bad }).success,
        `expected rejection: ${bad}`,
      ).toBe(false);
    }
  });

  it("test credential schema is strict — unknown fields rejected", () => {
    expect(
      testCredentialSchema.safeParse({ importerName: "github" }).success,
    ).toBe(true);
    expect(
      testCredentialSchema.safeParse({
        importerName: "github",
        unexpected: true,
      }).success,
    ).toBe(false);
  });

  it("update schema accepts a secretRefMap replacement", () => {
    const parsed = updateCredentialSchema.parse({
      secretRefMap: { token: { env: "NEW_VAR" } },
    });
    expect(parsed.secretRefMap).toEqual({ token: { env: "NEW_VAR" } });
  });
});

describe("credential.test frames", () => {
  const secrets = { token: { env: "GH_TOKEN" } };

  it("parses a credential.test frame", () => {
    const frame = {
      type: "credential.test",
      payload: {
        testId: "018c5e60-0000-7000-8000-000000000001",
        credentialId: "018c5e60-0000-7000-8000-000000000002",
        importerName: "github",
        secretRefMap: secrets,
      },
    };
    const parsed = agentMessageSchemas["credential.test"].parse(frame);
    expect(parsed.payload.secretRefMap).toEqual(secrets);
  });

  it("parses a credential.test.result frame", () => {
    const frame = {
      type: "credential.test.result",
      payload: {
        testId: "018c5e60-0000-7000-8000-000000000001",
        ok: true,
      },
    };
    const parsed = agentMessageSchemas["credential.test.result"].parse(frame);
    expect(parsed.payload.ok).toBe(true);
  });

  it("rejects a credential.test payload missing secrets", () => {
    expect(
      credentialTestPayloadSchema.safeParse({
        testId: "018c5e60-0000-7000-8000-000000000001",
        credentialId: "018c5e60-0000-7000-8000-000000000002",
        importerName: "github",
      }).success,
    ).toBe(false);
  });
});
