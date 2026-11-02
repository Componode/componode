import { ENVIRONMENTS, urlSafetyError } from "@componode/core";
import { z } from "zod";

const endpointOverride = (description: string) =>
  z
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
    .describe(description);

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
    region: z
      .string()
      .min(1)
      .optional()
      .describe("Pin all Alibaba SDK clients to this region (e.g. cn-hangzhou) — connectivity, not a discovery filter (that's regionIds); SDK default resolution when unset"),
    endpoint: endpointOverride(
      "Resource Center endpoint override (VPC/private gateway) — Resource Center only; use stsEndpoint/bssEndpoint for STS/BSS",
    ),
    stsEndpoint: endpointOverride(
      "STS endpoint override (VPC gateway/mock) — wins over region for STS; default resolution when unset",
    ),
    bssEndpoint: endpointOverride(
      "BSS endpoint override (VPC gateway/mock) — wins over region for BSS; default resolution when unset",
    ),
  })
  .strict();

export type AlibabaCloudConfig = z.infer<typeof alibabaCloudConfigSchema>;
