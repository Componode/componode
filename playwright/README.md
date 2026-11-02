# Componode Playwright Workload

**Status:** planning and handoff only; the test workload has not been implemented.

This folder is the source of truth for Playwright-specific research, mock contracts, coverage, fixture design, operating instructions, and session templates. The required spec-kit implementation artifacts are in [`../specs/055-playwright-workload/`](../specs/055-playwright-workload/).

## Start here

1. Read [`HANDOFF.md`](HANDOFF.md) before starting an implementation session.
2. Follow the authoritative task tracker at [`../specs/055-playwright-workload/tasks.md`](../specs/055-playwright-workload/tasks.md). Do not create a second progress checklist.
3. Review the [implementation plan](implementation-plan.md), [coverage matrix](coverage-matrix.md), [fixture matrix](data/fixture-matrix.md), [mock contracts](contracts/mock-api-contracts.md), and [research index](research/repository-facts.md).
4. Use [`research/official-references.md`](research/official-references.md) for primary provider and tooling sources.

## Boundaries

- The future workload is local Docker Compose only, with its own ports, environment, PostgreSQL state, storage, test identities, and internal runtime network.
- Its planned Compose project name is `componode-pw`, separate from the normal root project `componode`.
- Runtime traffic must remain inside the test network. Provider credentials and production services are never used.
- Only the five implemented importers are mocked and exercised: Alibaba Cloud, GitHub, Docker, web URL, and API URL. Scaffold importers become test scope when their behavior ships.
- The `054-url-check-onboarding` feature is integrated: branch `055-playwright-workload` fast-forwarded to commit `501ac17` ("feat(monitoring): complete URL check onboarding (spec 054)"), so the 055 base now contains the committed 054 first-instance recovery, composite URL Check auth fields, and preserve-versus-reconfigure changes.
- There is no CI workflow change and no PR proposal to `main`.
- Reports, generated certificates, storage states, test credentials, and local environment files remain ignored beneath this folder.

## Planned run contract

These commands are targets for implementation, not executable yet:

| Command | Intended behavior |
| --- | --- |
| `pnpm run e2e` | Preflight, create the isolated stack and fresh data, run the full suite, write reports, and tear down. |
| `pnpm run e2e:debug` | Start the same stack and retain it for investigation. |
| `pnpm run e2e:down` | Stop and remove only the workload's named Compose project. |

The implementation session must keep these commands synchronized with the actual scripts and [`quickstart.md`](quickstart.md).
