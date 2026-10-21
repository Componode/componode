import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Importer, ImporterRegistry } from "@componode/core";
import { handleCredentialTest } from "../src/client.js";
import { createAgentResolver, resolveRefMap, type AgentLog } from "../src/secrets.js";

// Agent-side credential.test handling (spec 026 US4): refs resolve on the
// agent host, the probe runs locally, and only ok/error goes back.
describe("agent credential.test handling", () => {
  const testId = "018c5e60-0000-7000-8000-000000000001";

  function makeLog() {
    const events: Array<{ level: string; fields: object; msg: string }> = [];
    const log: AgentLog = {
      info: (o, m) => events.push({ level: "info", fields: o, msg: m }),
      warn: (o, m) => events.push({ level: "warn", fields: o, msg: m }),
    };
    return { log, events };
  }

  function makeRegistry(importer?: Partial<Importer>): ImporterRegistry {
    return {
      getManifests: vi.fn(async () => []),
      getManifest: vi.fn(),
      getConfigSchema: vi.fn(),
      getImporter: vi.fn(async (name: string) => {
        if (!importer) throw new Error(`Importer ${name} not found`);
        return importer as Importer;
      }),
    } as unknown as ImporterRegistry;
  }

  function captureSend() {
    const frames: Array<{ type: string; payload: any }> = [];
    return {
      frames,
      send: (type: string, payload: unknown) =>
        frames.push({ type, payload }),
      last: () => frames[frames.length - 1]!,
    };
  }

  it("resolves env refs, runs testSecrets, and replies ok", async () => {
    process.env.AGENT_TEST_TOKEN = "secret-token-value";
    try {
      const { log, events } = makeLog();
      const probe = vi.fn(async () => ({ ok: true }));
      const registry = makeRegistry({ name: "github", testSecrets: probe });
      const tx = captureSend();

      await handleCredentialTest(
        {
          testId,
          credentialId: "018c5e60-0000-7000-8000-000000000002",
          importerName: "github",
          secretRefMap: { token: { env: "AGENT_TEST_TOKEN" } },
        },
        { registry, log, send: tx.send },
      );

      expect(probe).toHaveBeenCalledWith(
        { token: "secret-token-value" },
        undefined,
      );
      const frame = tx.last();
      expect(frame.type).toBe("credential.test.result");
      expect(frame.payload).toEqual({ testId, ok: true, error: undefined });

      // Resolution events: key name + source type — never the value.
      expect(events).toContainEqual({
        level: "info",
        fields: { key: "token", source: "env" },
        msg: "resolved secret reference",
      });
      expect(JSON.stringify(events)).not.toContain("secret-token-value");
      expect(JSON.stringify(tx.frames)).not.toContain("secret-token-value");
    } finally {
      delete process.env.AGENT_TEST_TOKEN;
    }
  });

  it("replies {ok:false} naming the missing env var — never other values", async () => {
    const { log } = makeLog();
    const registry = makeRegistry({ name: "github", testSecrets: vi.fn() });
    const tx = captureSend();

    await handleCredentialTest(
      {
        testId,
        credentialId: "018c5e60-0000-7000-8000-000000000002",
        importerName: "github",
        secretRefMap: { token: { env: "AGENT_MISSING_VAR" } },
      },
      { registry, log, send: tx.send },
    );

    const frame = tx.last();
    expect(frame.payload.ok).toBe(false);
    // US4 edge case: the failure names the credential key + source type.
    expect(frame.payload.error).toContain('"token"');
    expect(frame.payload.error).toContain("env");
    expect(frame.payload.error).toContain("AGENT_MISSING_VAR");
  });

  it("resolves a file ref under SECRETS_DIR", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-secrets-"));
    writeFileSync(join(dir, "gh-token"), "  file-token\n", "utf8");
    try {
      const { log } = makeLog();
      const resolved = await resolveRefMap(
        { token: { file: "gh-token" } },
        createAgentResolver(dir),
        log,
      );
      expect(resolved).toEqual({ token: "file-token" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("rejects traversal and absolute file refs with {ok:false}", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-secrets-"));
    try {
      const { log } = makeLog();
      const tx = captureSend();
      const registry = makeRegistry({ name: "github", testSecrets: vi.fn() });
      const payload = {
        testId,
        credentialId: "018c5e60-0000-7000-8000-000000000002",
        importerName: "github",
      };
      await handleCredentialTest(
        { ...payload, secretRefMap: { token: { file: "../escape" } } },
        { secretsDir: dir, registry, log, send: tx.send },
      );
      expect(tx.last().payload.ok).toBe(false);
      expect(tx.last().payload.error).toContain('"token"');
      expect(tx.last().payload.error).toContain("file");
      expect(tx.last().payload.error).toContain("escapes");

      await handleCredentialTest(
        { ...payload, secretRefMap: { token: { file: join(dir, "abs") } } },
        { secretsDir: dir, registry, log, send: tx.send },
      );
      expect(tx.last().payload.ok).toBe(false);
      expect(tx.last().payload.error).toContain("relative");
      // Sanitized: the absolute SECRETS_DIR path must not cross the wire.
      expect(tx.last().payload.error).not.toContain(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("replies {ok:false} for an importer without testSecrets", async () => {
    process.env.AGENT_TEST_TOKEN = "v";
    try {
      const { log } = makeLog();
      const registry = makeRegistry({ name: "web-url" }); // no testSecrets
      const tx = captureSend();
      await handleCredentialTest(
        {
          testId,
          credentialId: "018c5e60-0000-7000-8000-000000000002",
          importerName: "web-url",
          secretRefMap: { token: { env: "AGENT_TEST_TOKEN" } },
        },
        { registry, log, send: tx.send },
      );
      const frame = tx.last();
      expect(frame.payload.ok).toBe(false);
      expect(frame.payload.error).toContain("MANIFEST_NO_TEST");
      expect(frame.payload.error).toContain("does not support credential testing");
    } finally {
      delete process.env.AGENT_TEST_TOKEN;
    }
  });

  it("replies {ok:false} for an unknown importer name", async () => {
    const { log } = makeLog();
    const registry = makeRegistry(undefined);
    const tx = captureSend();
    await handleCredentialTest(
      {
        testId,
        credentialId: "018c5e60-0000-7000-8000-000000000002",
        importerName: "nonexistent",
        secretRefMap: {},
      },
      { registry, log, send: tx.send },
    );
    expect(tx.last().payload.ok).toBe(false);
  });

  it("returns the importer's probe failure as {ok:false, error}", async () => {
    process.env.AGENT_TEST_TOKEN = "v";
    try {
      const { log } = makeLog();
      const registry = makeRegistry({
        name: "github",
        testSecrets: vi.fn(async () => ({ ok: false, error: "bad credentials" })),
      });
      const tx = captureSend();
      await handleCredentialTest(
        {
          testId,
          credentialId: "018c5e60-0000-7000-8000-000000000002",
          importerName: "github",
          secretRefMap: { token: { env: "AGENT_TEST_TOKEN" } },
        },
        { registry, log, send: tx.send },
      );
      expect(tx.last().payload).toEqual({
        testId,
        ok: false,
        error: "bad credentials",
      });
    } finally {
      delete process.env.AGENT_TEST_TOKEN;
    }
  });

  it("resolves two ref maps sharing key names independently", async () => {
    process.env.AGENT_TEST_A = "value-a";
    process.env.AGENT_TEST_B = "value-b";
    try {
      const { log } = makeLog();
      const resolver = createAgentResolver();
      const a = await resolveRefMap({ token: { env: "AGENT_TEST_A" } }, resolver, log);
      const b = await resolveRefMap({ token: { env: "AGENT_TEST_B" } }, resolver, log);
      expect(a).toEqual({ token: "value-a" });
      expect(b).toEqual({ token: "value-b" });
    } finally {
      delete process.env.AGENT_TEST_A;
      delete process.env.AGENT_TEST_B;
    }
  });

  it("reads env at call time — agent-side rotation needs no hub change", async () => {
    const { log } = makeLog();
    const resolver = createAgentResolver();
    process.env.AGENT_ROTATE = "old-value";
    try {
      const before = await resolveRefMap({ token: { env: "AGENT_ROTATE" } }, resolver, log);
      process.env.AGENT_ROTATE = "new-value";
      const after = await resolveRefMap({ token: { env: "AGENT_ROTATE" } }, resolver, log);
      expect(before.token).toBe("old-value");
      expect(after.token).toBe("new-value");
    } finally {
      delete process.env.AGENT_ROTATE;
    }
  });
});
