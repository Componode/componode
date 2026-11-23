import { z } from "zod";
import { ENVIRONMENTS, urlSafetyError } from "@componode/core";

// Unrefined base — `testSecrets` parses `.partial()` configs, which Zod
// refuses on object schemas carrying refinements.
const githubConfigBase = z.object({
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

  includeBranchInventory: z
    .boolean()
    .default(true)
    .describe("Import the full branch inventory into component details"),
  includeBranchActivity: z
    .boolean()
    .default(false)
    .describe("Fetch last-commit timestamps per branch (one extra API call per branch)"),
  includeBranchInstances: z
    .boolean()
    .default(true)
    .describe("Emit one instance per repository branch (environment from mapping, OTHER fallback)"),
  includeReleaseInventory: z
    .boolean()
    .default(true)
    .describe("Import releases and tags inventory into component details"),
  includeLanguageBreakdown: z
    .boolean()
    .default(false)
    .describe("Import per-language byte breakdown (one extra API call per repo)"),
  includeDependencyGraph: z
    .boolean()
    .default(false)
    .describe("Import each repository's package inventory into its bill of materials. Uses GitHub's dependency graph, so private repositories need the 'Dependency graph' permission on the token."),
  importDeclaredEdges: z
    .boolean()
    .default(false)
    .describe("Import declared dependencies as catalog edges. Imported dependencies are added to the catalog without review. You can hide any edge later."),

  environmentMapping: z
    .record(z.string(), z.enum(ENVIRONMENTS))
    .optional()
    .describe("Map GitHub environment and branch names to DEV/TEST/STAGING/DEMO/PRODUCTION/OTHER (unmapped names report OTHER)"),
});

export const githubConfigSchema = githubConfigBase.refine(
  (c) => !c.importDeclaredEdges || c.includeDependencyGraph,
  {
    message: "Declared-edge import requires the dependency-graph package inventory",
    path: ["importDeclaredEdges"],
  },
);

export { githubConfigBase };

export type GithubConfig = z.infer<typeof githubConfigSchema>;
