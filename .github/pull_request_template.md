## Summary

<!-- What changed and why. Link the spec or issue if there is one. -->

## Docs & contract checklist

- [ ] API endpoint added/changed/removed → `docs/openapi.yaml` updated and `pnpm --filter @componode/backend docs:api` regenerated (`docs:api:check` gates CI)
- [ ] Importer touched (manifest, secrets, config schema, capabilities) → `pnpm --filter @componode/backend docs:importers` regenerated (`docs:importers:check` gates CI), and `docs/importers/<name>.md` covers setup, credentials, and common failures
- [ ] User-facing capability added/changed → the relevant guide page updated (`quickstart`, `using-the-catalog`, `credentials-and-access`, `deployment`)
- [ ] New or renamed doc page → added to the sidebar in `docs-site/.vitepress/config.ts` (`docs:sidebar:check` gates CI)
- [ ] Contract surface extended past a ratified ADR → amendment or new ADR in `researches/adrs/` with back-pointers (AGENTS.md → ADR fidelity)
- [ ] Never hand-edited `<!-- GENERATED -->` regions — they are regenerated, not edited

#### Test plan
<!-- How was this verified? Commands run, tests added. -->

Generated with Devin
