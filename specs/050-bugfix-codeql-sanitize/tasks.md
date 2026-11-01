# Tasks: CodeQL incomplete sanitization fix

- [x] T001 Write failing regression test `test/unit/md-escape.test.ts`
- [x] T002 Create `scripts/md-escape.ts` (`mdCell`)
- [x] T003 Use `mdCell` in `descriptionOf` (line ~140)
- [x] T004 Use `mdCell` in `renderIndexTable` row (line ~161)
- [x] T005 Verify `docs:importers` produces identical output and
      `docs:importers:check` passes
- [x] T006 Push and confirm CodeQL alerts 5/6 close on PR #212
