# Data Model: Two-Branch Release Management Strategy

This feature models no database entities. Its "entities" are git branches,
tags, pull requests, and pipeline states. Invariants matter more than
fields.

## Entities

### `develop` branch (integration line)

- Role: repository default branch; target of all feature/bugfix/dependabot
  PRs.
- State invariant: every commit has passed the full quality gate suite
  (enforced by required checks — merges are impossible otherwise).
- Relationship to `main`: always equal-or-ahead in content; genealogically
  linked because promotions merge (not squash).

### `main` branch (release line)

- Role: release-only. Receives merges exclusively from `develop` (promotion)
  or `hotfix/*` branches.
- State invariant: **every merge is a release** — declared version in
  `package.json` is always strictly ahead of the highest existing `v*` tag.
  Violations are detected by the tag workflow failing loudly.
- No direct pushes; no auto-merge; manual human merge only.

### Version tag (`v<major>.<minor>.<patch>`)

- Created automatically on push to `main` from declared version.
- Immutable; creation failure (already exists) is the invariant violation
  detector.
- Trigger for the publish pipeline.

### Promotion PR (`develop → main`)

- Opened automatically when declared version on `develop` ≠ latest release
  tag and no such PR is open.
- Self-updating (head is `develop` itself).
- Merge commit required. Manual merge = release approval.
- Lifecycle: OPEN → MERGED (release) or OPEN → drift (new commits arrive,
  maintainer judges) — never auto-merged, ideally never closed unmerged
  (close = cancel release decision).

### Version PR (`chore/version-x.y.z → develop`)

- Opened by the release workflow; contains `changeset version` output
  (version bump + changelog + consumed changesets).
- Auto-merge enabled; squash permitted. Protected-branch gates apply in
  full — no bypass.

### Hotfix PR (`hotfix/* → main`)

- Contains fix + changeset + author-run version bump in one auditable unit.
- Merge commit required. Triggers tag + publish exactly like a promotion.

### Back-merge PR (`main → develop`)

- Opened automatically after any hotfix merge to `main`.
- Merge commit. Conflicts resolved by humans.
- Preserves develop's unconsumed changesets — next promotion derivation
  unaffected.

### Pipeline states

- Quality gate suite: `{lint, typecheck, test, build, audit, docs-checks,
  e2e, dependency-review(pr), codeql, scorecard(push)}` × branches
  `{main, develop}` — the parity requirement is set equality across
  branches.
- Publish pipeline: idempotent — re-runnable for the same tag with
  convergent outcome.

## State transitions

```text
develop: feature PR merged ──▶ develop+1 (gates green)
maintainer: dispatch release ──▶ version PR opened ──▶ auto-merged
  ──▶ develop carries version bump
push to develop (version ≠ tag) ──▶ promotion PR opened/updated
human: merge promotion PR ──▶ main updated ──▶ tag created ──▶ publish
hotfix: PR merged to main ──▶ tag + publish; back-merge PR opened
```

## Validation rules

| Rule | Enforcement point |
|------|-------------------|
| No direct pushes to either branch | Branch rulesets |
| PRs to main only from develop/hotfix/* | CI gate job (in-repo, required) |
| Merge commits for promotion/hotfix/back-merge | Ruleset allowed-merge-types per branch + human practice |
| Version bump only at promotion/hotfix | Social + review; structurally concentrated in release workflow |
| Every merge to main is a release | tag.yml loud failure |
