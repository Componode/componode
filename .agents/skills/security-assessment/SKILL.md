---
name: "security-assessment"
description: "Produce a read-only, repository-wide security assessment report with Mermaid diagrams for architecture, data flow, authN/authZ, data storage, and deployment. Outputs a dated Markdown file under docs/security/."
compatibility: "Works in any project with source code, package manifests, and an optional architecture/ADR docs folder. The skill is read-only by default."
metadata:
  author: "componode"
  source: ".devin/skills/security-assessment/SKILL.md"
---


## When to use this skill

Invoke this skill when the user asks for a security assessment, architecture review, or dependency audit of the current repository without changing source code. Example triggers:

- "security assessment"
- "audit the repo"
- "assess our architecture and dependencies"
- "security posture report"
- "review authN/authZ flows"

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding. If the user provided a specific scope (e.g., "only backend" or "only dependencies"), respect it. If the input is empty, run the full assessment described below.

## Pre-Execution Checks

1. **Do not modify the codebase.** This skill is read-only except for creating the `docs/security/` directory (if missing) and writing the dated report.
2. **Identify the report date.** Use today's date in ISO format: `<YYYY-MM-DD>`.
3. **Determine the target path:** `docs/security/<YYYY-MM-DD>-security-assessment.md`.
4. **Locate foundational project documents** (if they exist):
   - `AGENTS.md` or `AGENTS`
   - `.specify/memory/constitution.md` or equivalent constitution/principles file
   - `researches/architecture-decisions.md`
   - `researches/adrs/` individual ADR files
   - `README.md`
   - `docs/deployment.md`, `docker-compose.yml`, `Dockerfile`, `.env.example`
   - Database initialization/migration scripts (`init-db.sql`, `*migrations*`, ORM config, schema files)
   - `.nvmrc`, `.node-version`, `.tool-versions`, or any runtime-version file
   - `.github/workflows/` CI/CD definitions
   - Root and workspace `package.json` files (including `engines` and `packageManager`)
   - `pnpm-lock.yaml`, `package-lock.json`, or `yarn.lock`
5. **Identify the source tree** (typical patterns):
   - Backend/API routes, services, plugins, database layer
   - Frontend routing, API client, auth pages, link/url handling
   - Core contracts, schemas, validation, constants
   - Importers or external-connector packages

## Execution

Perform a repository-wide security assessment. Follow this exact structure in the generated report.

### 1. Read and analyze

Read, in order:

- Foundational governance docs (`AGENTS.md`, `constitution.md`, architecture-decisions index)
- Security-focused ADRs / rules (search for `ADR-084` through `ADR-102` or equivalent)
- Deployment and operational docs (`docs/deployment.md`, `docker-compose.yml`, `Dockerfile`, `.env.example`)
- Runtime and infrastructure evidence (base image tags, `package.json` `engines`, `.nvmrc`, CI runner and action versions, database image and driver versions)
- Package manifests and lock files
- Backend application entry, plugins (auth, session, RBAC, CORS, CSRF, helmet, rate-limit, logging, error handling, metrics), routes, services, database layer, migrations
- Frontend entry, routing, auth pages, API client, safe-URL / external-link handling
- Core contracts, schemas, and validation
- In-tree importers / external connectors

### 2. Assess and report

For each area, describe the current state, cite specific files and line numbers, and call out deviations from the project's own documented rules.

#### Required assessment areas

- **Application architecture:** monorepo layout, packages, trust boundaries, network model.
- **End-to-end data flow:** browser → API → database → importers → external sources, and back.
- **AuthN/AuthZ flow:** registration, login, session creation/validation/idle timeout/revocation, logout, password reset, OIDC/OAuth2, RBAC/permissions, CSRF, CORS, cookie security.
- **Data storage and integrity:** database schema, least-privilege DB user, TLS, audit tables, append-only / immutable records, CHECK constraints, secret storage.
- **Deployment flow:** Docker build, Compose startup, migration execution, bootstrap admin, reverse proxy / TLS assumptions, runtime user, exposed ports, unauthenticated endpoints (`/health`, `/metrics`).
- **Database platform, version, and engine-specific risk:** DBMS product and version (e.g., PostgreSQL, MySQL, SQLite, MongoDB), documented minimum/required versions, EOL status, base image / container tag, database driver/connector version, ORM/query builder version, migrations or `sql.raw` calls that rely on DB-specific functions, extensions, or syntax (e.g., `gen_random_uuid()`, `pgcrypto`, JSON/JSON operators, full-text search), missing `CREATE EXTENSION` or equivalent setup, floating database image tags, and external database version drift with no runtime validation.
- **Runtime and infrastructure components:** Node.js/runtime version and EOL status, `package.json` `engines` and `.nvmrc`, base image (`Dockerfile`), OS packages, package-manager supply chain (pnpm/corepack), database base image / container tag, CI/CD runner and action versions, image scanning / SBOM practices, and any IaaC such as `init-db.sql` or reverse-proxy config.
- **Source-code security patterns:** input validation, SQL injection prevention, XSS prevention, error-sanitization, no `sql.raw()`/`sql.fragment()` in app code, no `dangerouslySetInnerHTML`, no `eval`/`new Function`, dependency sandboxing, log redaction, secrets handling.
- **Dependencies and runtime supply chain:** run `pnpm audit --prod` (or `npm audit --prod` / `yarn audit` as appropriate), list all findings with package, installed version, severity, GHSA/ID, and a one-line description. Also inspect `package.json` `engines`, `packageManager`, `Dockerfile` base image, `docker-compose.yml` images, database driver and ORM versions, CI action tags, and any `.nvmrc`/`.node-version` for EOL/floating-tag risks.

### 3. Include Mermaid diagrams

Embed **four** Mermaid diagrams in the report (as ` ```mermaid ` blocks):

1. **End-to-end data flow diagram** — shows actors, the frontend, backend, database, importers, and external APIs/data sources.
2. **AuthN/AuthZ flow diagram** — covers login, session validation, OIDC, role checks, CSRF, and logout.
3. **Data storage / trust-boundary diagram** — shows what lives in the browser, server memory, Postgres, env vars, secret files, and importer output; include trust boundaries.
4. **Deployment architecture diagram** — shows Docker Compose services, reverse proxy (if documented), the host, ports, TLS termination, and health/metrics access.

#### Mermaid syntax rules

To ensure the diagrams render correctly in Markdown/GitHub, follow these rules:

- Use `flowchart TD` (or `flowchart LR`) for all diagrams.
- Quote **all** node labels that contain spaces, slashes (`/`), colons (`:`), dots (`.`), equals (`=`), semicolons, braces (`{}`), parentheses, `@`, `<br/>`, or hyphens as part of a value (e.g., `HEA["/api/v1/health"]` not `HEA[/api/v1/health]`).
- Quote all arrow labels that contain any of the above characters (e.g., `FE -->|"POST /api/v1/auth/login"| LOGIN`).
- Do **not** use the parallelogram shape `[/text/]` for labels that contain a slash or close bracket; use quoted rectangle labels instead (`["text"]`).
- Prefer simple, short labels. Move URL/path/endpoint details into the label text rather than into custom node shapes.
- Avoid unquoted angle brackets or unclosed quotes inside node or edge labels.
- If a node label must span multiple lines, use the quoted `<br/>` tag inside a quoted label (`["line one<br/>line two"]`).
- Validate each diagram by eye or with a Mermaid previewer before finalizing the report.

### 4. Report structure

Write the report using this exact Markdown outline:

```markdown
# <Project> Security Assessment Report

- **Date:** <YYYY-MM-DD>
- **Scope:** Architecture, data flow, authN/authZ, deployment, source code, dependencies, runtime and infrastructure components
- **Methodology:** Read-only review of docs, ADRs, source code, and dependency audit
- **Limitations:** No dynamic testing, no access to running environment

## 1. Executive Summary
## 2. Scope and Methodology
## 3. Architecture and Data-Flow Summary
   (with the four Mermaid diagrams)
## 4. AuthN/AuthZ Deep-Dive
## 5. Data Storage and Integrity
## 6. Deployment and Operational Security
## 7. Security Controls (Strengths)
## 8. Findings
   - 8.1 Critical
   - 8.2 High
   - 8.3 Medium
   - 8.4 Low
   (each finding must include: Location, Description, Recommendation)
## 9. Dependency Vulnerability Summary
## 10. Rules/ADR Compliance Matrix
## 11. Prioritized Recommendations
## 12. Reproducing This Assessment / Generating Other Reports
```

### 5. Reproducibility section

In the final section, explicitly state:

- The exact files, commands, and tools used to produce the report.
- A checklist for re-running the same assessment.
- A list of follow-on reports that can be produced by reusing the same methodology, e.g.:
  - Dependency-only vulnerability report
  - SAST / source-code security report
  - RBAC and authorization-matrix review
  - Penetration-test checklist
  - Container / supply-chain hardening report
  - Runtime and base-image hardening report (Node.js EOL, OS packages, image SBOM)
  - Database platform and version risk review (DBMS EOL, driver, ORM, engine-specific features)
  - Secrets-management and credential-rotation report
  - API contract / OpenAPI drift report

## Constraints (hard rules)

- Do **not** edit, delete, or create any source, config, migration, workflow, or package files.
- Do **not** commit, push, or create pull requests.
- Do **not** run tests, builds, migrations, or any command that writes to the database or filesystem beyond the report.
- Read-only commands are allowed and encouraged (`pnpm audit --prod`, `pnpm list -r --depth=0`, `node --version`, `docker images` (if available), image scanners such as `trivy image` / `grype` (if available), `psql --version` / `mysql --version` / equivalent (if available), `grep`, `find`, `read`, etc.).
- If `docs/security/` does not exist, create it. Otherwise only add the dated report.
- If a file already exists with the same date, overwrite it only if the user asked for a fresh assessment; otherwise append a revision number to the filename.

## Output

- A single Markdown file at `docs/security/<YYYY-MM-DD>-security-assessment.md`.
- After writing, tell the user the absolute path and a one-paragraph summary of the top findings.
