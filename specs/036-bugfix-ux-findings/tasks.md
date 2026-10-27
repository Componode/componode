# Tasks: UX findings batch

## Phase 1 — Findings (appended as reported)

<!-- T001+ rows are appended per finding: failing test → fix → verify. -->

## Phase 2 — Ship (runs once, when the batch is approved)

- [ ] T901 Add changeset(s) for every touched package (patch for fixes)
- [ ] T902 Add `036-bugfix-ux-findings` to `docs/roadmap.md` shipped list + header bump
- [ ] T903 `pnpm lint && pnpm typecheck && pnpm test && pnpm build` green; mark draft PR ready for review — merge only on user approval
