# Plan: UX findings batch

## Working loop (per finding)

1. User reports a bug/finding in chat → record it as `F###` in `spec.md`
   (reported text, surface, reproduction).
2. Assess: root cause, blast radius, whether it extends a ratified contract
   surface (endpoints, error codes, enums → ADR fidelity rule).
3. Write the failing regression test; add a `T###` row to `tasks.md`.
4. Implement the minimal fix; keep fixes independent so the batch can be
   merged or split at review.
5. Verify locally (targeted tests → workspace gate before push).

## Batch hygiene

- Frontend-only fixes unless a finding proves backend-side.
- `docs/ux.md`/`researches/ux-rewrite-gaps.md` updated only when a finding
  intersects a documented gap or flag.
- Changesets + roadmap entry written at ship time (single commit or
  folded into the last fix commit).
