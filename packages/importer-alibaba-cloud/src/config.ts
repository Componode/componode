import { ENVIRONMENTS, urlSafetyError } from "@componode/core";
import { z } from "zod";

export const alibabaCloudConfigSchema = z
  .object({
    regionIds: z.array(z.string().min(1)).default([]).describe("Restrict discovery to these regions (all when empty)"),
    resourceTypes: z
      .array(z.string().min(1))
      .default([])
      .describe("Restrict to ACS::*::* types, e.g. ACS::OSS::Bucket (all when empty)"),
    resourceGroupId: z.string().min(1).optional().describe("Restrict to a resource group"),
    environment: z
      .enum(ENVIRONMENTS)
      .default("PRODUCTION")
      .describe("Environment tag on every instance"),
    enrichResources: z
      .boolean()
      .default(false)
      .describe("One GetResourceConfiguration call per resource — adds full config + status (~1 call per resource)"),
    includeCosts: z.boolean().default(false).describe("Attach details.billing per resource (needs BSS read)"),
    billingPeriod: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "billingPeriod must be YYYY-MM")
      .optional()
      .describe("Billing cycle to read (latest closed month when unset)"),
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
      .optional()
      .describe("Resource Center endpoint override (VPC/private gateway) — Resource Center only; STS/BSS use default resolution"),
  })
  .strict();

export type AlibabaCloudConfig = z.infer<typeof alibabaCloudConfigSchema>;
