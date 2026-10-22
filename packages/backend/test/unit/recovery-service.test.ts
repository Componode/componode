import { describe, it, expect, vi } from "vitest";

process.env.DATABASE_URL ??= "postgres://user:pass@localhost:5432/test";

// Capture the updates recoverRuns issues without a live database — the
// branch selection (remote vs in-process rows) is what this test pins.
const updated: { id: string; patch: Record<string, unknown> }[] = [];
let pendingRuns: { id: string; status: string; agentId: string | null; cancelRequestedAt: string | null }[] = [];

vi.mock("../../src/db/connection.js", () => ({
  db: {
    selectFrom: () => ({
      select: () => ({
        where: () => ({
          execute: async () => pendingRuns,
        }),
      }),
    }),
    updateTable: () => ({
      set: (patch: Record<string, unknown>) => ({
        where: (_col: string, _op: string, id: string) => ({
          execute: async () => {
            updated.push({ id, patch });
          },
        }),
      }),
    }),
  },
}));

const { recoverRuns } = await import("../../src/services/recovery-service.js");

describe("recoverRuns remote-run branch (spec 027)", () => {
  it("fails a remote RUNNING run with AGENT_LOST semantics", async () => {
    pendingRuns = [
      { id: "run-remote", status: "RUNNING", agentId: "agent-1", cancelRequestedAt: null },
      { id: "run-local", status: "RUNNING", agentId: null, cancelRequestedAt: null },
    ];
    updated.length = 0;

    await recoverRuns();

    const remote = updated.find((u) => u.id === "run-remote")!;
    expect(remote.patch.status).toBe("FAILED");
    expect(remote.patch.errorType).toBe("AGENT_LOST");

    const local = updated.find((u) => u.id === "run-local")!;
    expect(local.patch.status).toBe("INTERRUPTED");
  });

  it("completes a remote run whose cancel was already requested as CANCELLED", async () => {
    pendingRuns = [
      {
        id: "run-remote",
        status: "PENDING",
        agentId: "agent-1",
        cancelRequestedAt: new Date().toISOString(),
      },
    ];
    updated.length = 0;

    await recoverRuns();

    expect(updated[0].patch.status).toBe("CANCELLED");
  });
});
