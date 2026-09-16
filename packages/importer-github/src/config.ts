import { z } from "zod";
import { ENVIRONMENTS, urlSafetyError } from "@componode/core";

export const githubConfigSchema = z.object({
  org: z.string().min(1, "Organization is required"),
  baseUrl: z
    .string()
    .url()
    .superRefine((val, ctx) => {
      const reason = urlSafetyError(val);
      if (reason) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `URL is not allowed: ${reason}` });
        return;
      }
      if (new URL(val).protocol !== "https:") {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "URL is not allowed: HTTPS is required" });
      }
    })
    .optional(),
  repos: z.array(z.string().min(1)).optional(),
  includeForks: z.boolean().default(false),
  includeArchived: z.boolean().default(false),

  includeOrganization: z.boolean().default(true),
  includeBilling: z.boolean().default(true),
  billingPeriod: z.enum(["current", "previous"]).default("current"),

  includeEnvironments: z.boolean().default(true),
  includeReleases: z.boolean().default(true),
  includeWorkflows: z.boolean().default(false),
  includeRunners: z.boolean().default(false),
  includePackages: z.boolean().default(false),

  environmentMapping: z.record(z.enum(ENVIRONMENTS)).optional(),
});

export type GithubConfig = z.infer<typeof githubConfigSchema>;
