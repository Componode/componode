# Bugfix batch: UX findings from live iteration

> Accumulating spec — user-reported bugs and findings land here as `F###`
> entries. Each finding gets: root cause, regression test first, minimal fix,
> task row in `tasks.md`. One branch (`bugfix/036-ux-findings`), one PR, merged
> only when the user approves. Precedent for mechanics: `035-bugfix-user-form-validation`.

## Findings

### F001 — (template / first finding goes here)

- **Reported**: —
- **Surface**: —
- **Root cause**: —
- **Fix**: —
- **Regression test**: —

## Acceptance criteria (batch)

- Every finding below has a failing regression test written before its fix.
- No contract-surface change without an ADR amendment (per AGENTS.md ADR
  fidelity); endpoint changes sync `docs/openapi.yaml` + `docs/api.md`.
- `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green at ship.
- Changeset(s) added at ship time covering every touched package.
- Roadmap entry added on merge; gap registry touched only if a finding maps
  to a G-numbered gap.
