import { z } from "zod";
import { ENVIRONMENTS, urlSafetyError } from "@componode/core";

export const githubConfigSchema = z.object({
  org: z.string().min(1, "Organization is required").describe("Organization login to import"),
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
    .optional()
    .describe("GitHub Enterprise API base URL (github.com when unset)"),
  repos: z.array(z.string().min(1)).optional().describe("Restrict to named repositories (all when unset)"),
  includeForks: z.boolean().default(false).describe("Include forked repositories"),
  includeArchived: z.boolean().default(false).describe("Include archived repositories"),

  includeOrganization: z.boolean().default(true).describe("Emit the organization component"),
  includeBilling: z.boolean().default(true).describe("Fetch billing usage (needs `admin:org`)"),
  billingPeriod: z
    .enum(["current", "previous"])
    .default("current")
    .describe("Which billing month to read"),

  includeEnvironments: z.boolean().default(true).describe("Import deployment environments"),
  includeReleases: z.boolean().default(true).describe("Import latest release per repo"),
  includeWorkflows: z.boolean().default(false).describe("Import Actions workflows per repo"),
  includeRunners: z.boolean().default(false).describe("Import org self-hosted runners (needs `admin:org`)"),
  includePackages: z.boolean().default(false).describe("Import org packages (needs `admin:org`)"),

  environmentMapping: z
    .record(z.string(), z.enum(ENVIRONMENTS))
    .optional()
    .describe("Map GitHub environment names to DEV/TEST/STAGING/DEMO/PRODUCTION/OTHER"),
});

export type GithubConfig = z.infer<typeof githubConfigSchema>;
