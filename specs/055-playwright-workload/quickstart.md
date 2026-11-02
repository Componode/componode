# Quickstart Validation Guide

The implementation command contract and safety checklist are maintained in [`../../playwright/quickstart.md`](../../playwright/quickstart.md). The commands are planned and are not executable until the tasks in [`tasks.md`](tasks.md) are implemented.

The implementation must make the normal local path a single command that:

1. Verifies the correct worktree, Docker availability, port availability, and disposable environment values.
2. Creates the fresh isolated Compose stack and waits for health.
3. Runs database migrations and deterministic fixtures.
4. Runs the full suite, writes HTML and JUnit reports, and retains failure-only evidence.
5. Removes only the named test Compose project and its disposable database state.

A separate debug command must leave the stack available. A separate cleanup command must remove only the workload's named project. See the Playwright quickstart for the intended operator sequence and expected safety checks.
