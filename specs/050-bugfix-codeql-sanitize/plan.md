# Plan: CodeQL incomplete sanitization fix

1. Add `scripts/md-escape.ts` exporting `mdCell(value)` —
   `\` → `\\` first, then `|` → `\|`, whitespace collapse, trim.
2. `generate-importer-docs.ts`: import `mdCell`, use it in
   `descriptionOf` and the index-table row (label + description cells).
3. `test/unit/md-escape.test.ts`: escape order, whitespace, passthrough.
4. Verify: `docs:importers:check` still passes (no output drift),
   backend unit tests, CodeQL re-scan on PR #212.
