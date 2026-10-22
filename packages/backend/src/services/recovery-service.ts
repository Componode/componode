import { db } from "../db/connection.js";

export async function recoverRuns(): Promise<void> {
  const now = new Date().toISOString();

  const runs = await db
    .selectFrom("import_runs")
    .select(["id", "status", "agentId", "cancelRequestedAt"])
    .where("status", "in", ["PENDING", "RUNNING"])
    .execute();

  for (const run of runs) {
    if (run.agentId !== null) {
      // Remote runs (spec 027): the dispatch state lives in hub memory and
      // is gone after a restart — and the session itself is dead. Fail the
      // run with remote-loss semantics rather than leaving it active
      // forever; a cancel that was already requested completes as CANCELLED.
      if (run.cancelRequestedAt !== null) {
        await db
          .updateTable("import_runs")
          .set({ status: "CANCELLED", completedAt: now })
          .where("id", "=", run.id)
          .execute();
      } else {
        await db
          .updateTable("import_runs")
          .set({
            status: "FAILED",
            completedAt: now,
            currentPhase: "Failed",
            errorType: "AGENT_LOST",
            errorMessage: "Hub restarted while the run was owned by an Import Agent",
          })
          .where("id", "=", run.id)
          .execute();
      }
    } else if (run.status === "PENDING") {
      await db
        .updateTable("import_runs")
        .set({ status: "INTERRUPTED", completedAt: now })
        .where("id", "=", run.id)
        .execute();
    } else if (run.cancelRequestedAt !== null) {
      await db
        .updateTable("import_runs")
        .set({ status: "CANCELLED", completedAt: now })
        .where("id", "=", run.id)
        .execute();
    } else {
      await db
        .updateTable("import_runs")
        .set({ status: "INTERRUPTED", completedAt: now })
        .where("id", "=", run.id)
        .execute();
    }
  }
}
