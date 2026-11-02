# Quickstart: validating the repeated-failure policy

**Feature**: `056-url-check-failure-policy` | **Date**: 2026-11-02

## Automated validation (primary)

```bash
cd packages/backend && pnpm test          # integration suite (testcontainers)
cd packages/frontend && pnpm test          # status/badge unit tests
```

The backend suite proves: streak increments on `FAILURE` and `MISSED`
(including bulk backlog `MISSED`), resets on `SUCCESS`, disables at the
global default and at a per-check override, never disables when the
effective threshold is `0`, accrues no rows while auto-disabled, writes a
system-actor `auto_disable` audit entry, and resets the streak on manual
re-enable.

## Manual smoke (docker compose stack)

1. `URL_CHECK_AUTO_DISABLE_AFTER=3` on the hub; create a Component with a
   ComponentInstance, add a check pointing at a guaranteed-fail URL
   (e.g. `http://127.0.0.1:1/`), cadence 60 s.
2. Within ~3 minutes the check shows **Auto-disabled** on the Component
   card and detail page; observations stop accruing — including no
   post-disable `MISSED` inflation.
3. Activity feed shows a `url_check disabled` entry by the system actor
   with `reason: auto_disable`.
4. Toggle the check back on: badge clears to the normal state, streak
   resets (next `SUCCESS` is a clean slate), probing resumes.
5. Set the check's override to `0` (never): failures continue past the
   global threshold without disabling.

## Spec-status sweep validation

```bash
grep -rn "^**Status**: Draft" specs/ | grep -v 056   # → no output
grep -rLn "^**Status**: Shipped" specs/*/spec.md      # → only 056 (until ship commit)
```
