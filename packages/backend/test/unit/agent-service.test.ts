import { describe, it, expect, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";
process.env.COOKIE_SECRET ??= "test-secret-test-secret-test-secret";

// Unit coverage for the check-then-insert race in createAgent (T079): a
// concurrent create can win the UNIQUE(name) constraint between the
// assertNameFree pre-check and the insert — the pg unique violation must map
// to the same 409 AGENT_NAME_TAKEN the pre-check produces, not a 500.

let insertError: { code?: string } | undefined;
const trx = {
  insertInto: () => ({
    values: () => ({
      execute: async () => {
        if (insertError) throw insertError;
      },
    }),
  }),
};

vi.mock("../../src/db/connection.js", () => ({
  db: {
    selectFrom: () => ({
      select: () => ({
        where: () => ({ executeTakeFirst: async () => undefined }),
      }),
    }),
    transaction: () => ({
      execute: async (cb: (t: typeof trx) => unknown) => cb(trx),
    }),
  },
}));

const { createAgent, AgentError } =
  await import("../../src/services/agent-service.js");

const ACTOR = { id: "admin-1", name: "admin" };

describe("createAgent name-uniqueness race", () => {
  it("maps a 23505 unique violation to 409 AGENT_NAME_TAKEN", async () => {
    insertError = { code: "23505" };
    await expect(
      createAgent({ name: "edge-agent" }, ACTOR),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "AGENT_NAME_TAKEN",
    });
    await expect(
      createAgent({ name: "edge-agent" }, ACTOR),
    ).rejects.toBeInstanceOf(AgentError);
  });

  it("re-throws non-unique insert errors unchanged", async () => {
    insertError = { code: "XX000" };
    const err = await createAgent({ name: "edge-agent" }, ACTOR).catch(
      (e) => e,
    );
    expect(err).not.toBeInstanceOf(AgentError);
    expect((err as { code?: string }).code).toBe("XX000");
  });
});
