import { z } from "zod";
import { AGENT_PROTOCOL_VERSION } from "../constants/import-agent.js";

// Import Agent control channel contract (spec 025, contracts/agent-protocol.md).
// One outbound wss:// stream carries all frames as JSON. Foundation ships
// hello/hello.ok/heartbeat/close/error; the rest are reserved for 026/027.

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

const envelope = <T extends z.ZodTypeAny>(payload: T) =>
  z.object({
    type: z.string(),
    runId: z.string().optional(),
    payload,
  });

export const agentMessageSchemas = {
  hello: envelope(helloPayloadSchema),
  "hello.ok": envelope(helloOkPayloadSchema),
  heartbeat: envelope(heartbeatPayloadSchema),
  close: envelope(closePayloadSchema),
  error: envelope(errorPayloadSchema),
} as const;

export const AGENT_MESSAGE_TYPES = Object.keys(
  agentMessageSchemas,
) as AgentMessageType[];
export type AgentMessageType = keyof typeof agentMessageSchemas;

// Reserved for 026/027 — defined here so agent and hub cannot diverge.
export const FUTURE_AGENT_MESSAGE_TYPES = [
  "job.assign",
  "job.ack",
  "asset.batch",
  "phase",
  "run.complete",
  "run.error",
  "cancel",
  "credential.test",
  "credential.test.result",
] as const;

export type AgentHelloPayload = z.infer<typeof helloPayloadSchema>;
export type AgentHelloOkPayload = z.infer<typeof helloOkPayloadSchema>;
export type AgentHeartbeatPayload = z.infer<typeof heartbeatPayloadSchema>;
export type AgentClosePayload = z.infer<typeof closePayloadSchema>;
export type AgentCloseReason = AgentClosePayload["reason"];
export type AgentErrorPayload = z.infer<typeof errorPayloadSchema>;

export interface AgentMessage<T = unknown> {
  type: AgentMessageType | (typeof FUTURE_AGENT_MESSAGE_TYPES)[number];
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
