# GitHub importer

Imports a GitHub organization — its profile, repositories, environments,
releases, workflows, self-hosted runners, packages, and billing usage — as
catalog components.

## What it creates

- One **organization component** carrying the coverage/capability summary.
- One **component per repository**, plus instances for branches,
  environments (mapped to Componode environments), latest release,
  workflows, deployments — depending on which sections you enable.

## Prerequisites in GitHub

1. **Choose the organization** you want to import (`org` config field).
2. **Create a personal access token**:
   - *Classic PAT* — minimum scopes `repo` and `read:org` for the org profile,
     repos, teams, environments, releases, and workflows. Add `admin:org`
     for billing usage, self-hosted runners, and packages.
   - *Fine-grained PAT* — grant organization read access plus
     Administration read for the org-level sections; billing/runners/packages
     need organization administration access.
3. If your org enforces **SAML SSO**, authorize the token for the
   organization after creating it.
4. For **GitHub Enterprise Server**, set `baseUrl` to your instance's API URL
   (`https://<ghes-host>/api/v3`). HTTPS is required.

## Credentials

| Secret key | Required | How to get it |
|---|---|---|
| `token` | Yes | GitHub → Settings → Developer settings → Personal access tokens |

Use the credential **Test** action after saving — it calls the rate-limit
endpoint, the smallest authenticated request available.

## Configuration

| Field | Type | Default | Description |
|---|---|---|---|
| `org` | string | — | Organization login to import (required) |
| `baseUrl` | URL | github.com | GitHub Enterprise API base URL |
| `repos` | string[] | all | Restrict to named repositories |
| `includeForks` | bool | `false` | Include forked repositories |
| `includeArchived` | bool | `false` | Include archived repositories |
| `includeOrganization` | bool | `true` | Emit the organization component |
| `includeBilling` | bool | `true` | Fetch billing usage (needs `admin:org`) |
| `billingPeriod` | `current`/`previous` | `current` | Which billing month to read |
| `includeEnvironments` | bool | `true` | Import deployment environments |
| `includeReleases` | bool | `true` | Import latest release per repo |
| `includeWorkflows` | bool | `false` | Import Actions workflows per repo |
| `includeRunners` | bool | `false` | Import org self-hosted runners (needs `admin:org`) |
| `includePackages` | bool | `false` | Import org packages (needs `admin:org`) |
| `environmentMapping` | record | unset | Map GitHub environment names → `DEV`/`TEST`/`STAGING`/`DEMO`/`PRODUCTION`/`OTHER` |

## Behavior notes

- Sections the token can't reach degrade to `capabilities.*` markers on the
  organization component — the run still succeeds. Check
  `details.capabilities` on the org component if a section is missing.
- Large orgs with `includeWorkflows`/`includePackages`/`includeRunners` make
  substantially more API calls; enable them only if you need them.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| Run fails during "Authenticating" | Token invalid/revoked, or not authorized for a SAML org |
| `capabilities.billing` = `FORBIDDEN` | Token lacks `admin:org` — expected for read-only setups |
| Empty repo list | Wrong `org` name, or token can't see private repos (needs `repo`) |
| `baseUrl` rejected | Must be HTTPS and not a private/loopback address |

## Source identity

Identity is `{canonicalApiBaseUrl}org/{orgId}` — the org is fetched before any
asset is yielded, so an empty inventory still registers the Source. When org
details are unreadable the identity falls back to `{base}login/{org}` (mirroring
the org asset's own `login:` externalId fallback). github.com `externalId`s
are unchanged; GHES deployments qualify them with the source identity
(`{base}org/{id}::{externalId}`) on the first adopted run because numeric
IDs collide across GHES instances. No migration backfill (the org id needs a
live API call) — existing orgs adopt on their next run.
