import { z } from "zod";
import { AGENT_PROTOCOL_VERSION } from "../constants/import-agent.js";
import { secretRefMapSchema } from "../schemas/credential.js";

// Import Agent control channel contract (spec 025, contracts/agent-protocol.md).
// One outbound wss:// stream carries all frames as JSON. Foundation ships
// hello/hello.ok/heartbeat/close/error; spec 026 adds credential.test /
// credential.test.result; spec 027 activates the job-execution family
// (job.assign/job.ack/asset.batch/phase/run.error/run.complete/cancel).

const importerSpecSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
});

export const helloPayloadSchema = z
  .object({
    // Any int is accepted at the wire boundary; lockstep equality is checked
    // by the hub's handshake validator so a mismatch gets a distinct reason.
    protocolVersion: z.number().int().min(1),
    agentVersion: z.string().min(1),
    importers: z.array(importerSpecSchema),
    capabilities: z.object({
      maxConcurrentJobs: z.number().int().min(1),
    }),
  })
  .strict();

export const helloOkPayloadSchema = z
  .object({
    protocolVersion: z.literal(AGENT_PROTOCOL_VERSION),
    agentId: z.string().uuid(),
    name: z.string().min(1),
    allowedImporters: z.array(z.string()),
    heartbeatIntervalMs: z.number().int().min(1),
    maxConcurrentJobs: z.number().int().min(1),
    serverTime: z.string().min(1),
  })
  .strict();

export const heartbeatPayloadSchema = z
  .object({
    currentJobs: z.number().int().min(0),
    maxConcurrentJobs: z.number().int().min(1),
    activeRunIds: z.array(z.string()),
  })
  .strict();

export const closePayloadSchema = z
  .object({
    reason: z.enum([
      "normal",
      "invalid_hello",
      "protocol_mismatch",
      "importer_mismatch",
      "superseded",
      "replaced",
      "revoked",
      "shutdown",
    ]),
    detail: z.string().optional(),
    supportedVersions: z.array(z.number().int()).optional(),
  })
  .strict();

export const errorPayloadSchema = z
  .object({
    code: z.string().min(1),
    message: z.string(),
    runId: z.string().optional(),
  })
  .strict();

// Remote credential test (spec 026, ADR-117): the hub ships the credential's
// reference map — refs name sources, never values. Correlation is the
// payload `testId`, NOT the envelope runId (a test is not an import run).
export const credentialTestPayloadSchema = z
  .object({
    testId: z.string().uuid(),
    credentialId: z.string().uuid(),
    // Bounded because the agent echoes the name into result errors.
    importerName: z.string().min(1).max(100),
    scope: z.record(z.unknown()).optional(),
    secretRefMap: secretRefMapSchema,
  })
  .strict();

export const credentialTestResultPayloadSchema = z
  .object({
    testId: z.string().uuid(),
    ok: z.boolean(),
    error: z.string().optional(),
  })
  .strict();

// Job execution frames (spec 027, ADR-116): one job = one import run; the
// envelope `runId` correlates every frame. `job.assign` carries the config
// scope plus the merged AGENT_MANAGED reference map — names, never values.
export const jobAssignPayloadSchema = z
  .object({
    importerName: z.string().min(1).max(100),
    scope: z.record(z.unknown()).optional(),
    secretRefMap: secretRefMapSchema.optional(),
  })
  .strict();

export const jobAckPayloadSchema = z
  .object({
    accepted: z.boolean(),
    reason: z.string().max(500).optional(),
  })
  .strict();

// Assets are wire-validated per-item by the hub's contract validator — the
// frame schema only bounds the batch shape; an invalid asset becomes a
// run error row, not a protocol violation.
export const assetBatchPayloadSchema = z
  .object({
    assets: z.array(z.unknown()).min(1).max(100),
  })
  .strict();

export const phasePayloadSchema = z
  .object({
    name: z.string().min(1).max(200),
  })
  .strict();

// Per-asset, non-fatal — the run continues.
export const runErrorPayloadSchema = z
  .object({
    assetExternalId: z.string().max(500).optional(),
    errorType: z.string().min(1).max(100),
    errorMessage: z.string().min(1).max(2000),
  })
  .strict();

export const runCompletePayloadSchema = z
  .object({
    result: z.enum(["COMPLETED", "CANCELLED", "FAILED"]),
    errorType: z.string().max(100).optional(),
    errorMessage: z.string().max(2000).optional(),
  })
  .strict();

export const cancelPayloadSchema = z
  .object({
    runId: z.string().uuid(),
  })
  .strict();

const envelope = <T extends z.ZodTypeAny>(payload: T) =>
  z.object({
    type: z.string(),
    runId: z.string().optional(),
    payload,
  });

// Job frames require the envelope `runId` — it is the job correlation key.
const jobEnvelope = <T extends z.ZodTypeAny>(payload: T) =>
  z.object({
    type: z.string(),
    runId: z.string().uuid(),
    payload,
  });

export const agentMessageSchemas = {
  hello: envelope(helloPayloadSchema),
  "hello.ok": envelope(helloOkPayloadSchema),
  heartbeat: envelope(heartbeatPayloadSchema),
  close: envelope(closePayloadSchema),
  error: envelope(errorPayloadSchema),
  "credential.test": envelope(credentialTestPayloadSchema),
  "credential.test.result": envelope(credentialTestResultPayloadSchema),
  "job.assign": jobEnvelope(jobAssignPayloadSchema),
  "job.ack": jobEnvelope(jobAckPayloadSchema),
  "asset.batch": jobEnvelope(assetBatchPayloadSchema),
  phase: jobEnvelope(phasePayloadSchema),
  "run.error": jobEnvelope(runErrorPayloadSchema),
  "run.complete": jobEnvelope(runCompletePayloadSchema),
  cancel: jobEnvelope(cancelPayloadSchema),
} as const;

export const AGENT_MESSAGE_TYPES = Object.keys(
  agentMessageSchemas,
) as AgentMessageType[];
export type AgentMessageType = keyof typeof agentMessageSchemas;

export type AgentHelloPayload = z.infer<typeof helloPayloadSchema>;
export type AgentHelloOkPayload = z.infer<typeof helloOkPayloadSchema>;
export type AgentHeartbeatPayload = z.infer<typeof heartbeatPayloadSchema>;
export type AgentClosePayload = z.infer<typeof closePayloadSchema>;
export type AgentCloseReason = AgentClosePayload["reason"];
export type AgentErrorPayload = z.infer<typeof errorPayloadSchema>;
export type AgentCredentialTestPayload = z.infer<typeof credentialTestPayloadSchema>;
export type AgentCredentialTestResultPayload = z.infer<typeof credentialTestResultPayloadSchema>;
export type JobAssignPayload = z.infer<typeof jobAssignPayloadSchema>;
export type JobAckPayload = z.infer<typeof jobAckPayloadSchema>;
export type AssetBatchPayload = z.infer<typeof assetBatchPayloadSchema>;
export type PhasePayload = z.infer<typeof phasePayloadSchema>;
export type RunErrorPayload = z.infer<typeof runErrorPayloadSchema>;
export type RunCompletePayload = z.infer<typeof runCompletePayloadSchema>;
export type CancelPayload = z.infer<typeof cancelPayloadSchema>;

export interface AgentMessage<T = unknown> {
  type: AgentMessageType;
  runId?: string;
  payload: T;
}

// Decode a hub-facing frame; throws ZodError on malformed input.
export function parseAgentMessage(raw: unknown): AgentMessage {
  const base = z
    .object({
      type: z.string(),
      runId: z.string().optional(),
      payload: z.unknown(),
    })
    .parse(raw);
  const schema =
    agentMessageSchemas[base.type as AgentMessageType] ??
    z.object({
      type: z.string(),
      runId: z.string().optional(),
      payload: z.unknown(),
    });
  return schema.parse(raw) as AgentMessage;
}
