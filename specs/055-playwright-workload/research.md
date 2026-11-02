# Research: Componode Playwright User Testing

Detailed repository findings and primary references are maintained under [`../../playwright/research/`](../../playwright/research/) and [`../../playwright/contracts/`](../../playwright/contracts/). This file records the decisions needed by the spec-kit plan without duplicating the full research.

## Decisions

| Decision | Rationale | Alternative rejected |
| --- | --- | --- |
| Keep the test runner in a nested standalone pnpm workspace | It creates its own lockfile and avoids root workspace or lockfile changes. | Joining the root workspace expands the change outside the requested folder. |
| Use a dedicated Compose project and internal-only runtime network | Project-scoped networks/volumes and blocked egress prevent normal-stack writes and live provider calls. | Reusing the regular Compose project risks state and port collisions. |
| Reuse the root app Dockerfile and existing `**/.env*` ignore | The existing application image is the system under test; test env and private runtime material stay under `.env*` paths. | A second app image duplicates deployment behavior; modifying root Docker files is unnecessary. |
| Mock only currently implemented importer behavior | Five importer packages call external APIs; four are scaffolds with no provider behavior yet. | Mocking scaffold APIs would create false contracts. |
| Use GitHub as the representative complete reconciliation importer | It produces multi-asset, paginated inventories suitable for add/update/omit and shared-Source scenarios. | Repeating the same core lifecycle across every adapter adds cost without testing separate core logic. |
| Use DNS aliases and a trusted local CA for fixed Alibaba STS/BSS hosts | Those SDK clients do not accept endpoint overrides. The Resource Center client does. | Live cloud calls violate isolation; adding application endpoint overrides changes product code. |
| Use an mTLS Docker Engine fake | The Docker importer requires verified TLS for TCP targets, and a fake provides deterministic read-only responses without host-socket access. | Docker-in-Docker adds privileged daemon complexity and nondeterministic state. |
| Use Dex for local OIDC | Dex exercises standard discovery, authorization-code, PKCE, token, and JWKS behavior with a static local user. | A custom OIDC mock duplicates security-sensitive protocol behavior. |
| Test pagination through Playwright API requests where UI controls do not exist | Current UI auto-fetches Components pages and exposes no pagination buttons; activity and Suggestions have offset/limit APIs. | Adding nonexistent UI controls would test a fictional product behavior. |
| Run serialized, with a real Import Agent and isolated offline case | One worker protects shared DB/mock state; a registered disconnected Agent tests missed probes without controlling the host Docker daemon. | Parallel mutable scenarios or Docker socket access weakens determinism/isolation. |
| Keep CI, visual diff baselines, and production credentials out of initial scope | The request is local research/planning and the UI has frequent changes; failure evidence and accessibility assertions provide first-step feedback. | CI wiring or screenshot baselines expands scope and introduces unrelated external changes. |

## Important implementation prerequisite

The 055 worktree is based on committed 053 code (`81fc186`). The 054 URL Check onboarding changes are now committed on branch `054-url-check-onboarding` (pushed to origin). Before implementing or running dependent journeys, integrate that branch into `055-playwright-workload` and record the integration in `playwright/README.md`.

## Research locations

- Repository inventory, route/role facts, table counts, and pagination: [`playwright/research/repository-facts.md`](../../playwright/research/repository-facts.md).
- Provider/tooling primary references: [`playwright/research/official-references.md`](../../playwright/research/official-references.md).
- Mock endpoint contracts: [`playwright/contracts/mock-api-contracts.md`](../../playwright/contracts/mock-api-contracts.md).
- Fixture/data lifecycle: [`playwright/data/fixture-matrix.md`](../../playwright/data/fixture-matrix.md).
