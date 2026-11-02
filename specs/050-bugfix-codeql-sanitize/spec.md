# Bugfix: CodeQL incomplete sanitization in generate-importer-docs

**Status**: Shipped

## Problem

PR #212 CodeQL scan flagged two `js/incomplete-sanitization` (high)
findings in `packages/backend/scripts/generate-importer-docs.ts`:

- line ~140 (`descriptionOf`) and line ~161 (`renderIndexTable`) escaped
  `|` for Markdown table cells with `.replace(/\|/g, "\\|")` but did not
  escape `\` first. A `\` before a `|` in input produces an ambiguous
  escape sequence — the canonical fix is escaping backslashes before
  the character being escaped.

## Root cause

Markdown-cell sanitization applied a single-character escape and
skipped the backslash pass. Both call sites duplicated the same
incomplete pattern.

## Fix

Extract `mdCell()` into `scripts/md-escape.ts` — escapes `\` before
`|`, collapses whitespace, trims — and use it at both call sites (plus
the index-table label cell for defense in depth).

## Regression test

`packages/backend/test/unit/md-escape.test.ts` covers pipe escaping,
backslash-first ordering (`a\|b` → `a\\\|b`), whitespace collapse, and
passthrough text.

## Scope

Scripts-only change; no runtime code, no contract surface (no ADR
needed). Generated docs output is unchanged — no current input
contains backslashes.
