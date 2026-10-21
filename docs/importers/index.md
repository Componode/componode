# Importers

Importers pull assets from external systems into the Componode catalog. Each
importer runs inside the backend, reads from one provider, and produces
**Components** with **Component Instances** — it never writes back to the
source system.

## Available importers

| Importer | What it imports | Credentials required | Status |
|---|---|---|---|
| [GitHub](./github) | Organization, repositories, environments, releases, workflows, runners, packages, billing usage | Personal access token | Full |
| [Alibaba Cloud](./alibaba-cloud) | Account inventory via Resource Center (ECS, OSS, RDS, VPC, …), optional per-resource config and costs | RAM AccessKey pair | Full |
| [API URL](./api-url) | A single API endpoint, probed over HTTP | None | Full |
| [Web URL](./web-url) | A single web page/endpoint, probed over HTTP | None | Full |
| [AWS](./aws) | Placeholder asset scaffold | None | Scaffold — no live discovery yet |
| [Azure](./azure) | Placeholder asset scaffold | None | Scaffold — no live discovery yet |
| [Kubernetes](./kubernetes) | Placeholder asset scaffold | None | Scaffold — no live discovery yet |
| [MCP Server](./mcp-server) | Placeholder asset scaffold | None | Scaffold — no live discovery yet |

Scaffold importers register the provider and emit a placeholder component so
configurations and runs work end-to-end, but they do not call the external
API yet. Their pages describe what a real connection will require.

## How an import works

1. **Store a credential** — under Settings → Credentials, create a credential
   bundle holding the secret keys the importer needs (e.g. a GitHub token or
   an Alibaba AccessKey pair). Credentials are encrypted at rest and
   write-only over the API. Use the **Test** action to verify them before
   running.
2. **Create an importer configuration** — pick the importer type, attach the
   credential, and set the scope fields (org, regions, resource types, …).
3. **Trigger a run** — runs execute in the background. Each run reports
   progress phases, errors, and a result summary.
4. **Reconciliation** — components are matched across runs by a stable
   external ID, so re-running the same importer updates existing components
   instead of duplicating them. Resources that disappear are marked gone by
   the backend, not deleted.

## Common concepts

- **Coverage summary** — cloud importers record on the account/organization
  component how many resources were discovered, imported, and skipped
  (including the list of skipped resource types).
- **Capability markers** — optional sections that need extra permissions
  (billing, enrichment, …) degrade to a `FORBIDDEN`/`ERROR`/`UNAVAILABLE`
  marker on the component's `details.capabilities` instead of failing the
  run. The base import still succeeds.
- **Environment** — every imported instance is tagged with an environment
  (`DEV`, `TEST`, `STAGING`, `DEMO`, `PRODUCTION`, `OTHER`). Where the
  importer supports it you choose the default; URL importers use
  `PRODUCTION`.
- **URL safety** — URL fields reject `localhost`, private/loopback/link-local
  IPs, and non-HTTP(S) schemes. Public hostnames can still resolve to private
  addresses, so restrict egress on the container network if untrusted users
  can configure importers.

## Per-importer guides

Each importer page covers: what it imports, what to set up in the external
tool (accounts, services, permissions), required and optional credentials,
every configuration field, and troubleshooting for common failures.
