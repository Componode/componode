# Local Run Contract

**Planning artifact:** these commands are requirements for the later implementation session and do not exist yet.

## Normal run

The final standalone workspace should provide one normal command, intended as:

```text
pnpm run e2e
```

It must preflight Docker and ports, generate per-run secrets under ignored paths, start the uniquely named Compose project, wait for health, run migrations and fixtures, run the suite, write HTML/JUnit reports, and clean up the test stack on both success and failure.

## Debug run

The final workspace should expose a separate debug command, intended as:

```text
pnpm run e2e:debug
```

It performs the same isolated setup but leaves services and the disposable DB available. It prints safe service names and report locations, never secret values.

## Cleanup

The final workspace should expose an explicit cleanup command, intended as:

```text
pnpm run e2e:down
```

It removes only the Compose project named by the test workload. It must not invoke broad Docker prune operations or target the ordinary project Compose project.

## Expected outputs

- HTML report and JUnit XML beneath ignored `playwright/` report paths.
- Trace, screenshot, and video for failed tests only.
- No generated credential, OIDC secret, CA private key, Docker client key, enrollment token, or storage state in tracked files.
- Runtime network requests confined to the test stack; provider API aliases resolve locally and no provider egress is available.

## First-run prerequisites

- Docker Engine and Docker Compose are available.
- The local app image and Playwright browser image can be built/pulled before the runtime network is isolated.
- The 054 URL Check onboarding work is committed and integrated into the 055 branch before dependent journeys run.
- Default host ports are free or overridden in ignored `playwright/.env.test`.
