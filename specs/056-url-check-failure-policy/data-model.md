# Data Model: URL Check repeated-failure policy

**Feature**: `056-url-check-failure-policy` | **Date**: 2026-11-02

One migration (`027_url_check_auto_disable.ts`) extends `url_checks`. No
other table changes; `url_check_observations` is unchanged — the streak is
a maintained counter, not derived state (research Decision 1).

## `url_checks` — added columns

| Column                | Type          | Constraints                                                        | Semantics                                                                                                                                                                                                                                          |
| --------------------- | ------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `autoDisableAfter`    | `integer`     | `NULL` or `0–1000` (CHECK from `URL_CHECK_AUTO_DISABLE_AFTER_MAX`) | Per-check override of the consecutive-failure threshold. `NULL` = inherit `URL_CHECK_AUTO_DISABLE_AFTER` (default 12); `0` = never auto-disable this check.                                                                                        |
| `consecutiveFailures` | `integer`     | `NOT NULL DEFAULT 0`                                               | Maintained streak: `+1` per non-`SUCCESS` observation (`+n` for bulk MISSED batches), reset to `0` on `SUCCESS`, manual re-enable, and manual disable-then-enable. Only mutated in the transaction that writes the observation or flips `enabled`. |
| `autoDisabledAt`      | `timestamptz` | `NULL`                                                             | Set exactly when the streak reaches the effective threshold and the check auto-disables; cleared whenever `enabled` becomes `true`. `enabled=false` + `autoDisabledAt IS NOT NULL` = auto-disabled state.                                          |

`UrlCheckRow` in `db/types.ts` gains the three fields
(`consecutiveFailures: Generated<number>` is not Generated — it is written
explicitly; `autoDisabledAt: string | null`; `autoDisableAfter: number | null`).

## Effective threshold resolution

```text
effectiveThreshold(check) =
  check.autoDisableAfter IS NOT NULL ? check.autoDisableAfter
                                     : envInt("URL_CHECK_AUTO_DISABLE_AFTER", 12)
0 => never auto-disable
```

## State transitions

```text
ENABLED --non-SUCCESS observation--> consecutiveFailures += n
ENABLED --SUCCESS observation------> consecutiveFailures = 0
ENABLED --streak >= threshold------> DISABLED (autoDisabledAt=now, nextProbeAt=null)
ENABLED --manual PATCH enabled=false-> DISABLED (autoDisabledAt stays NULL)
DISABLED --manual PATCH enabled=true-> ENABLED (consecutiveFailures=0,
                                       autoDisabledAt=null, nextProbeAt=now)
DISABLED (any kind) --time passes--> no observations accrue
```

Invariants enforced by the write paths (verified by tests):

- `consecutiveFailures` only changes inside the transaction that records
  the outcome — it can never disagree with the observation history by
  construction of the two write paths.
- A late-arriving observation for an already-disabled check inserts the
  row but does not mutate the streak or re-arm `nextProbeAt`
  (existing `enabled = true` update guard).
- `autoDisabledAt` is never set on a manual disable and never survives a
  re-enable.

## `UrlCheck` API shape — added fields

`autoDisableAfter: number | null`, `consecutiveFailures: number`,
`autoDisabledAt: string | null` — exposed on single-check and list
responses so the card and detail view can render the auto-disabled state
without a second request.
