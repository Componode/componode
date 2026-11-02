# API Contract Delta: URL Check auto-disable

**Feature**: `056-url-check-failure-policy` | **Date**: 2026-11-02

No new or removed endpoints. The `UrlCheck` schema grows three fields;
create/update schemas accept one new field. `docs/openapi.yaml` is updated
in the same change and `docs/api.md` regenerated via `pnpm docs:api`
(ADR-104).

## Schema additions (core)

`UrlCheck` gains:

```json
{
  "autoDisableAfter": "number | null — per-check threshold override; null = inherit global; 0 = never",
  "consecutiveFailures": "number — current non-SUCCESS streak (read-only)",
  "autoDisabledAt": "string | null — ISO timestamp of the auto-disable transition; null = not auto-disabled"
}
```

`createUrlCheckSchema` / `updateUrlCheckSchema` gain:

```json
{
  "autoDisableAfter": "integer, 0–1000, nullable, optional — omit/null = inherit global"
}
```

`consecutiveFailures` and `autoDisabledAt` are server-managed — never
accepted on input.

## Behavior contract

- `POST /components/{componentId}/url-checks` — accepts optional
  `autoDisableAfter`; new checks start `consecutiveFailures=0`,
  `autoDisabledAt=null`.
- `PATCH /url-checks/{id}` — accepts `autoDisableAfter`. `enabled: true`
  on a disabled check resets `consecutiveFailures` and `autoDisabledAt`
  and re-arms `nextProbeAt` (existing behavior plus the two resets).
- `GET` responses embed the three fields (single check, component list,
  composite-create response).
- On threshold: the check row flips `enabled=false`,
  `autoDisabledAt=<now>`, `nextProbeAt=null`, and a `url_check` audit
  event with `action="disabled"`, `changes.reason="auto_disable"`, and a
  null-actor (system) is written in the same transaction.
- No endpoint errors change; no permissions change
  (`urlCheck:*` unchanged).

## Frontend status vocabulary

`checkStatusOf` maps `enabled=false && autoDisabledAt!=null` to a new
`AUTO_DISABLED` status rendered as an "Auto-disabled" badge distinct from
`DISABLED`; detail copy shows the threshold and disable timestamp.
