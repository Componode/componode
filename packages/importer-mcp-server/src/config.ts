import { z } from "zod";

export const mcpServerConfigSchema = z
  .object({
    resourceTypes: z
    .array(z.string().min(1))
    .default(["tools/list"])
    .describe("MCP method labels; one placeholder component each"),
    endpoint: z
    .string()
    .url()
    .optional()
    .describe("Recorded on the asset's details/url; reserved for the server's transport URL"),
    // Admin-supplied stable source key (ADR-120) — fallback when
    // `endpoint` is absent; one of the two is required.
    sourceKey: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe("Fallback source identity when `endpoint` is absent — one of the two is required (ADR-120)"),
  })
  .refine(
    (c) => c.endpoint || c.sourceKey,
    { message: "endpoint or sourceKey is required (source identity)" },
  );

export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;
