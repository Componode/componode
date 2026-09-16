# Contract: GitHub Importer Scope & Emitted Assets

**Date**: 2026-09-13 | **Spec**: [spec.md](../spec.md)

This feature adds no REST endpoints — the importer config schema is delivered
through the existing manifest/config-schema path and `DiscoveredAsset` through
the existing run service. `docs/openapi.yaml` is unchanged (ADR-104 N/A). The
contracts that change are the GitHub importer's **config schema** and its
**emitted asset shapes**.

## Config schema (`githubConfigSchema`)

```ts
z.object({
  org: z.string().min(1),
  baseUrl: z.string().url().superRefine(urlSafety).optional(), // GHES
  repos: z.array(z.string().min(1)).optional(),                // repo allowlist
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
})
```

### Semantics

- `repos` allowlist scopes **repo-level** assets only; org-level collection
  (organization, billing, runners, packages) runs whenever enabled.
- `baseUrl` targets the GitHub API root (`https://api.github.com` default;
  `https://<ghes-host>/api/v3` for GHES); `urlSafetyError` enforces HTTPS +
  hostname (no literal private IPs).
- `environmentMapping` keys are environment/branch **names** matched
  case-insensitively against the merged default map (data-model.md).
- `billingPeriod` selects the month for usage snapshots.
- Secrets: `{ token: <PAT> }` — unchanged. Scopes: `read:org` minimum;
  org-admin/`admin:org` for billing.

## Emitted `DiscoveredAsset` shapes

Per data-model.md — summary of identity keys (all rename-stable):

| resourceType | category | externalId | instances |
|---|---|---|---|
| `github:organization` | `ACCOUNT` | `String(org.id)` | none |
| `github:repository` | `REPOSITORY` | `String(repo.id)` | `branch:{name}` per mapped branch + `env:{name}` per GH environment |
| `github:workflow` | `JOB` | `{repoId}:{workflowId}` | none |
| `github:runner` | `COMPUTE` | `String(runner.id)` | none |
| `github:package` | `PACKAGE_REGISTRY` | `String(package.id)` | none |

## Capability marker contract

Every conditional section in org `details` reports
`{status: "OK" | "FORBIDDEN" | "ERROR" | "UNAVAILABLE", message?}`:

- `FORBIDDEN` — 403 from GitHub (missing scope/permission)
- `UNAVAILABLE` — 404 (endpoint not on this platform, e.g. GHES billing) or
  feature disabled on the account
- `ERROR` — any other failure; logged, run continues
- `OK` — section populated

Markers never fail the run; they exist so the catalog shows *why* data is
absent rather than silently omitting it (details are overwritten wholesale
each run).

## Frontend form contract

`importer-config-form.tsx` GitHub section gains: `baseUrl` text input,
`billingPeriod` select, five capability switches, and an
`environmentMapping` input (comma-separated `name=ENV` pairs, e.g.
`main=PRODUCTION, develop=DEV`). Fields serialize into `scope` as above.
