import { z } from "zod";

export const mcpServerConfigSchema = z.object({
  resourceTypes: z.array(z.string().min(1)).default(["tools/list"]),
  endpoint: z.string().url().optional(),
  // Admin-supplied stable source key (ADR-120) — fallback when `endpoint`
  // is absent; one of the two is required at run time.
  sourceKey: z.string().trim().min(1).optional(),
});

export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;
