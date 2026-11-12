import type { Environment, InstanceStatus } from "../constants/index.js";

export interface ComponentInstance {
  id: string;
  componentId: string;
  /** Effective environment — the human override when set, else the
   *  importer-reported value (spec 071). */
  environment: Environment;
  /** The importer-reported/baseline environment — always the stored
   *  non-override value; equals `environment` when not overridden. */
  reportedEnvironment: Environment;
  /** Human-set environment override, or null when not overridden. */
  environmentOverride: Environment | null;
  environmentOverriddenBy: string | null;
  environmentOverriddenAt: string | null;
  url?: string | null;
  region?: string | null;
  status: InstanceStatus;
  version?: string | null;
  deployedAt?: string | null;
  rawConfig?: Record<string, unknown> | null;
  externalId: string;
  slug: string;
  lastSeenAt?: string | null;
  lastSeenInRunId?: string | null;
  createdBy?: string | null;
  updatedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}
