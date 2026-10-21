import { ENVIRONMENTS, urlSafetyError } from "@componode/core";
import { z } from "zod";

export const alibabaCloudConfigSchema = z
  .object({
    regionIds: z.array(z.string().min(1)).default([]),
    resourceTypes: z.array(z.string().min(1)).default([]),
    resourceGroupId: z.string().min(1).optional(),
    environment: z.enum(ENVIRONMENTS).default("PRODUCTION"),
    enrichResources: z.boolean().default(false),
    includeCosts: z.boolean().default(false),
    billingPeriod: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "billingPeriod must be YYYY-MM")
      .optional(),
    endpoint: z
      .string()
      .url()
      .superRefine((val, ctx) => {
        const reason = urlSafetyError(val);
        if (reason) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `URL is not allowed: ${reason}`,
          });
        }
      })
      .optional(),
  })
  .strict();

export type AlibabaCloudConfig = z.infer<typeof alibabaCloudConfigSchema>;
