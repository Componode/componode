# Quickstart: validating the standardized list pages

**Feature**: `068-list-page-standards` | Prereq: repo built, `docker compose`
stack or local `pnpm dev` running, seeded catalog (>100 components
recommended — the local dev DB already has 108 with `includeGone`).

## 1. Server-side pagination

```bash
# First page only — one request, 25 rows
curl -s -b <session> "localhost:3000/api/v1/components?page=1&pageSize=25" \
  | jq '{n: (.data|length), p: .pagination}'
# → n=25, pagination.total=108 (or current total)

# Page 2 continues the set; pageSize=100 returns up to 100
curl -s -b <session> "localhost:3000/api/v1/components?page=2&pageSize=25" | jq '.data|length'
curl -s -b <session> "localhost:3000/api/v1/components?pageSize=100" | jq '.pagination.hasNext'
```

UI: `/components` shows a pager with 25/50/100; switching size resets to
page 1; URL gains `?page=…&size=…`.

## 2. Sorting

```bash
curl -s -b <session> "localhost:3000/api/v1/components?sort=lastSeenAt&order=desc&pageSize=5" \
  | jq -r '.data[].lastSeenAt'   # strictly non-increasing
curl -s -b <session> "localhost:3000/api/v1/components?sort=bogus"   # → 400 VALIDATION_FAILED
```

UI: click "Last seen" header twice → desc; sort state in URL; page 2
keeps global ordering.

## 3. Filters + URL state + the gone regression

```bash
# includeGone still works and worstStatus no longer leaks GONE when hidden
curl -s -b <session> "localhost:3000/api/v1/components?includeGone=true&pageSize=100" | jq '.pagination.total'
curl -s -b <session> "localhost:3000/api/v1/components?includeGone=false&pageSize=100&sort=health" | jq '.data[].worstStatus'  # no "GONE" values
```

UI regression (the reported bug): `/components` → "Gone instances" →
select **Shown** → control stays "Shown", count grows, URL updates;
selecting **All** no longer exists as a bogus option; **Clear** appears
only when something is actually filtered.

## 4. Folded backend fixes

```bash
curl -s -b <session> "localhost:3000/api/v1/components?lifecycle=RETIRED&pageSize=5" | jq '.pagination.total'   # >0 (was 0)
curl -s -b <session> "localhost:3000/api/v1/component-groups?bogus=1"  # → 400, not 500
```

## 5. Migrated envelopes

```bash
curl -s -b <session> "localhost:3000/api/v1/suggestions?status=PENDING&page=1&pageSize=25" | jq '{n:(.data|length), p:.pagination.page}'
curl -s -b <session> "localhost:3000/api/v1/audit/activity?page=1&pageSize=25" | jq '.pagination.total'
```

## 6. Hover summaries

UI: hover any title cell on `/components` or `/products` → summary card
with the entity's key fields; long names truncate; no extra request in
the network tab.

## 7. Automated gates

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build   # per changed package
cd playwright && pnpm e2e --grep "list"                  # targeted suite
pnpm docs:api:check                                      # openapi drift (if script exists)
```
