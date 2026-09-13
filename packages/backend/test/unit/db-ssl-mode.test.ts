import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

// Regression for 2026-09-10 assessment finding 8.3.4: DATABASE_SSL_MODE
// defaulted to `disable` even in production.
describe("DATABASE_SSL_MODE default", () => {
  const saved: Record<string, string | undefined> = {};

  function stubEnv(env: Record<string, string | undefined>) {
    for (const [k, v] of Object.entries(env)) {
      if (!(k in saved)) saved[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(async () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
      delete saved[k];
    }
    try {
      const { closeDb } = await import("../../src/db/connection.js");
      await closeDb();
    } catch { /* module not loaded */ }
  });

  it("production defaults to require (TLS on, no CA verification)", async () => {
    stubEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://db.internal:5432/componode",
      DATABASE_SSL_MODE: undefined,
    });
    const { pool } = await import("../../src/db/connection.js");
    expect(pool.options.ssl).toMatchObject({ rejectUnauthorized: false });
  });

  it("non-production defaults to disable (no TLS)", async () => {
    stubEnv({
      NODE_ENV: "test",
      DATABASE_URL: "postgres://127.0.0.1:1/componode",
      DATABASE_SSL_MODE: undefined,
    });
    const { pool } = await import("../../src/db/connection.js");
    expect(pool.options.ssl).toBeUndefined();
  });

  it("an explicit DATABASE_SSL_MODE always wins over the default", async () => {
    stubEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgres://db.internal:5432/componode",
      DATABASE_SSL_MODE: "verify-full",
    });
    const { pool } = await import("../../src/db/connection.js");
    expect(pool.options.ssl).toMatchObject({ rejectUnauthorized: true });
  });
});
