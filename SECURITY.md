# Security Policy

## Supported Versions

Componode is a self-hosted, single-organization product that ships as a
monorepo release. Security fixes are applied to `main` and released under
the next version tag; only the versions below receive security updates.

| Version         | Supported          |
| --------------- | ------------------ |
| Latest release  | :white_check_mark: |
| `main`          | :white_check_mark: |
| Older releases  | :x:                |

Deployments tracking tagged releases should upgrade to the latest release
to receive security fixes. Deployments tracking `main` receive fixes as
they land.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report vulnerabilities through **GitHub private vulnerability reporting**:

<https://github.com/Componode/componode/security/advisories/new>

This creates a private Security Advisory visible only to the maintainers,
where a fix can be developed and a coordinated disclosure arranged.

When reporting, please include:

- A description of the vulnerability and its potential impact.
- Steps to reproduce, including the affected version/commit and
  deployment topology where relevant.
- Any proof-of-concept material (requests, configs, scripts).

## Response Expectations

- **Acknowledgement** of your report within **72 hours**.
- **Triage and severity assessment** within **7 days**, with a target fix
  window communicated in the advisory — typically **30 days** for
  high-severity issues and **90 days** for lower severities.
- Credit in the release notes and advisory unless you prefer to remain
  anonymous.

## Scope Notes

Componode is self-hosted: the operator controls the deployment, its
network exposure, and its secrets. The following are **in scope**:

- Authentication and session handling (local auth, OIDC integration).
- Importer credential handling — the `credentials` store, secret
  encryption (AES-256-GCM), and agent-managed credentials.
- Import Agent enrollment, the hub–agent stream, and remote execution.
- Server-side request forgery, injection, and privilege-escalation paths
  reachable through the API or importer configuration.
- Supply-chain integrity of shipped artifacts (workflows, container
  images, dependencies).

The following are generally **out of scope** unless they expose a defect
in Componode itself:

- Vulnerabilities requiring an already-compromised host or database.
- Denial-of-service requiring resource exhaustion of the host.
- Findings in third-party dependencies with no demonstrated exploit path
  through Componode — report those upstream and open a dependency issue.
- Self-XSS and attacks requiring a victim to perform impossible actions.

## Related Documentation

- Security architecture and threat model: `docs/security.md`
- Deployment hardening (TLS, proxy trust, secrets): `docs/deployment.md`
