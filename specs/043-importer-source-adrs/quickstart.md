# Quickstart — Validating the ADR Ratification

**Feature**: 043-importer-source-adrs

Docs-only feature: validation is textual inspection + formatting, not
test runs.

## Prerequisites

- Branch `043-importer-source-adrs` checked out.
- `researches/docker-importer-implementation-tracking.md` Phase-0
  checklist at hand.

## Validation steps

1. **Surface coverage** — open `contracts/decision-surfaces.md`; for each
   row, confirm the named ADR section exists and states the rule:

   ```powershell
   ls researches/adrs/ADR-119-*.md
   rg -l "Amendment" researches/adrs/ADR-035-*.md researches/adrs/ADR-036-*.md researches/adrs/ADR-037-*.md researches/adrs/ADR-047-*.md researches/adrs/ADR-056-*.md researches/adrs/ADR-065-*.md researches/adrs/ADR-077-*.md researches/adrs/ADR-116-*.md
   ```

   Expected: ADR-119 exists; every listed ADR contains an Amendment (or
   for ADR-037, also an Amendment) dated 2026-10-31 referencing ADR-119.

2. **Back-pointer completeness** — for each amended ADR, confirm the
   `---` + `**Amended by ADR-119**:` block at file end, and that ADR-119's
   `**Amendments to earlier ADRs**:` list names exactly the ADRs actually
   amended.

3. **Index sync** — `researches/architecture-decisions.md` lists ADR-119
   and annotates amended rows consistently with the existing style.

4. **Vocabulary sync** — `CONTEXT.md` defines **ImporterSource** (with
   `Avoid:` guidance) and the Source-membership/target-profile terms;
   `AGENTS.md` importer-contract and deletion bullets reflect the amended
   rules.

5. **Acceptance walk-through** — answer each spec acceptance scenario by
   reading only `researches/adrs/` files (SC-004). Example: "config
   deleted → Source `UNMONITORED`, run history preserved" must be
   answerable from ADR-119/ADR-047 without opening the research notes.

6. **Formatting** — `pnpm prettier --check` on all touched Markdown
   passes.

## Expected outcome

All Phase-0 checklist items in the tracking file resolve to ratified ADR
text; zero contract surfaces remain defined only in
`researches/docker-importer-*.md`.
