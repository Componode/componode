---
title: Contributing
description: Development setup, quality gates, and the spec-kit workflow.
---

# Contributing

Componode is a personal learning project exploring how applications are
built today with AI coding assistants — and it's not written by a
professional developer. Contributions of every kind are welcome, and the
single most valuable one is **telling me what a professional would do
differently**: a design smell, a missing test, a doc that doesn't make
sense, a security decision you'd question.

## Ways to help

- **Review and critique** — open an issue about anything that looks wrong.
- **Docs** — corrections, clarifications, translations of jargon.
- **Code** — bug fixes and features; see the workflow below before starting.
- **Try it and report** — quickstart friction and importer failures are
  high-value bug reports.

## Development setup

Prerequisites: **Node.js 24+**, **pnpm 9+**, **Docker** (for PostgreSQL and
integration tests).

```bash
git clone https://github.com/Componode/componode.git
cd componode
pnpm install

# Dev database (publishes Postgres with the pgcrypto-enabled init script)
docker run -d --name componode-db -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres \
  -v "$PWD/init-db.sql:/docker-entrypoint-initdb.d/init-db.sql:ro" \
  postgres:16-alpine
```

Set backend env vars (`packages/backend/.env` or exported — the backend
reads `process.env` directly):

```text
DATABASE_URL=postgres://componode:componode_pw@localhost:5432/componode
DATABASE_SSL_MODE=disable
COOKIE_SECRET=<openssl rand -base64 32>
BOOTSTRAP_ADMIN_USERNAME=admin
BOOTSTRAP_ADMIN_PASSWORD=<8+ chars>
```

Run the dev servers (migrations and bootstrap admin happen on first boot):

```bash
pnpm --filter @componode/backend dev     # API on :3000
pnpm --filter @componode/frontend dev    # UI on :5173, proxies to :3000
```

## Quality gates

Run before opening a PR:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

- **Test-first is non-negotiable** — a failing test before implementation;
  testcontainers cover DB-touching code.
- Dependencies change via `pnpm add` in the owning package, `^x.y.z` ranges,
  `pnpm-lock.yaml` committed, `pnpm audit --prod --audit-level=high` clean.
- API changes must update `docs/openapi.yaml` and regenerate `docs/api.md`
  (`pnpm --filter @componode/backend docs:api`) — a contract test enforces it.

## The spec-kit workflow

Feature work is spec-driven. Each feature gets `specs/{NNN-feature}/` with
`spec.md` → `plan.md` → `tasks.md`, produced and executed via the repo's
`speckit-*` skills. Bugfixes use a lighter `NNN-bugfix-*` variant that still
requires a regression test.

The binding rules live in
[`.specify/memory/constitution.md`](https://github.com/Componode/componode/blob/main/.specify/memory/constitution.md)
(7 principles) and the ADR index in
[`researches/architecture-decisions.md`](https://github.com/Componode/componode/blob/main/researches/architecture-decisions.md).
[`AGENTS.md`](https://github.com/Componode/componode/blob/main/AGENTS.md)
is the full rulebook the AI agents follow — worth a read, since the same
rules apply to human PRs.

## Notes for contributors

- Importer packages depend only on `packages/core` — never on backend or
  other importers; every importer needs a guide under `docs/importers/`.
- New user-facing capability → update the relevant page in this
  documentation set in the same change.
- Keep the [vocabulary](./vocabulary) — specs, UI copy, and comments use
  canonical terms.
