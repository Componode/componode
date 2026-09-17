import * as cron from "node-cron";
import { db } from "../db/connection.js";
import { startRun } from "./import-run-service.js";

interface ScheduledJob {
  configId: string;
  task: cron.ScheduledTask;
}

const scheduledJobs = new Map<string, ScheduledJob>();

function validateCron(expression: string): boolean {
  return cron.validate(expression);
}

export async function scheduleConfig(config: {
  id: string;
  schedule: string | null;
  enabled: boolean;
}): Promise<void> {
  // Remove any existing schedule first
  unscheduleConfig(config.id);

  if (!config.enabled || !config.schedule) {
    return;
  }

  if (!validateCron(config.schedule)) {
    return;
  }

  const task = cron.schedule(config.schedule, async () => {
    try {
      await startRun(config.id, null);
    } catch {
      // Scheduled runs should not throw to the scheduler; errors are persisted on the run row.
    }
  });

  scheduledJobs.set(config.id, { configId: config.id, task });
}

export function unscheduleConfig(configId: string): void {
  const job = scheduledJobs.get(configId);
  if (job) {
    job.task.stop();
    scheduledJobs.delete(configId);
  }
}

export async function rescheduleConfig(config: {
  id: string;
  schedule: string | null;
  enabled: boolean;
}): Promise<void> {
  unscheduleConfig(config.id);
  await scheduleConfig(config);
}

export async function initScheduler(): Promise<void> {
  const configs = await db
    .selectFrom("importer_configs")
    .select(["id", "schedule", "enabled"])
    .where("enabled", "=", true)
    .where("schedule", "is not", null)
    .execute();

  for (const config of configs) {
    await scheduleConfig({ id: config.id, schedule: config.schedule, enabled: config.enabled });
  }
}

export function stopScheduler(): void {
  for (const job of scheduledJobs.values()) {
    job.task.stop();
  }
  scheduledJobs.clear();
}
