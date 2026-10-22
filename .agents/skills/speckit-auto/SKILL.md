---
name: speckit-auto
description: "Autonomous spec-kit pipeline: specify → clarify → plan → tasks → implement → converge/review loop → push PR. Use when the user wants a feature driven end-to-end from a description."
allowed-tools:
  - read
  - write
  - edit
  - exec
  - grep
  - glob
  - run_subagent
---

Drive the feature described in $ARGUMENTS end-to-end through the spec-kit
pipeline. Report a one-line status after each stage. One feature per run.

## Stage 1 — Specify

Invoke /speckit-specify $ARGUMENTS.

When it reports SPECIFY_FEATURE_DIRECTORY (specs/<NNN>-<short-name>), create
and switch to branch `<NNN>-<short-name>` — no `.specify/extensions.yml`
exists in this repo, so the before_specify hook that normally creates the
branch never runs.

## Stage 2 — Clarify (conditional human gate)

Invoke /speckit-clarify.

- If it asks questions, the session pauses for the user naturally —
  integrate their answers and continue.
- If it reports "No critical ambiguities detected", continue immediately.

Do NOT add an extra approval pause here.

## Stage 3 — Plan & Tasks

Invoke /speckit-plan, then /speckit-tasks.

## Stage 4 — Implement

Invoke /speckit-implement. If it halts on the checklist gate or a failed
task, surface the blocker to the user — do not force past it silently.

## Stage 5 — Converge loop (max 8 rounds total)

Invoke /speckit-converge.

- tasks_appended → invoke /speckit-implement → converge again.
- converged → Stage 6.
- Still findings after 8 rounds → STOP, report the findings table.

## Stage 6 — Review loop (max 8 rounds total)

Invoke the code-review skill, fixed point `main`, spec path
`specs/<NNN>-<short-name>/spec.md`.

- Findings → inject them into tasks.md: append a new `## Phase N: Review`
  section following the converge append contract (next sequential
  zero-padded task IDs T{M+1:03d}…, one item per finding, ordered
  CRITICAL/HIGH first, tagged with its source — `code-review: standards`
  or `code-review: spec`). Then invoke /speckit-implement to execute them,
  and re-run code-review.
- Clean → Stage 7.
- Still findings after 8 rounds → STOP, report both axes' findings.

## Stage 7 — Sanity converge

Invoke /speckit-converge one final time.

- converged → Stage 8.
- tasks_appended → invoke /speckit-implement, then return to Stage 5 —
  the loop re-runs converge and code-review since the code changed.
  The 8-round budgets in Stages 5 and 6 are cumulative across the whole
  run; re-entering the loop does NOT reset them.

## Stage 8 — Ship (authorized: push without asking)

Verify AGENTS.md done-criteria first:

- ADR amendments/back-pointers for any touched contract surface
  (ADR fidelity rule in AGENTS.md).
- docs/roadmap.md — mark the feature shipped, revise the Next entry.
- docs/openapi.yaml regenerated if endpoints changed (ADR-104).
- docs/importers/<name>.md updated if an importer changed.

Then run `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.
Commit (write the message to a temp file, `git commit -F <file>` —
per the AGENTS.md Windows rule) → `git push -u origin <branch>` →
open the PR per the pr skill with `gh pr create --body-file`.
Report the PR URL.

## Abort conditions

- Any stage errors twice on the same step → STOP and report.
- The 8/8 budgets in Stages 5 and 6 count total rounds across the run,
  including re-entries via Stage 7 — they never reset.
- If $ARGUMENTS is empty, ask for the feature description instead of
  guessing.
