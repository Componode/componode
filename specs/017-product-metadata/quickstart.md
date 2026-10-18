# Quickstart Validation: Practical Catalog Metadata

Prerequisites: repo deps installed (`pnpm install`), Postgres running via
the dev instructions in `README.md` (docker-run Postgres with a published
port), backend + frontend dev servers up.

## Validation scenarios

### 1. Links (US1)

- Create a product "Checkout" with links `[{title:"Runbook",
  url:"https://wiki/runbook"},{title:"Repo", url:"https://github.com/x"}]`.
- Open the product detail → links card shows both in entered order; each
  opens its URL.
- Edit → try `url: "javascript:alert(1)"` or empty title → rejected inline,
  nothing saved.
- Add links until 20 → the 21st is rejected with a limit message.

### 2. Tags + filter (US2)

- Tag two products `pci`, one `beta` (enter `PCI`, ` pci `, `pci` → stored
  as one `pci`).
- Product list → filter `tag=pci` → only the two appear; component list →
  tag a component and filter the same way.
- Try tag `Foo Bar` (space) or a 33-char tag → inline rejection.

### 3. Criticality (US3)

- Set product criticality `CRITICAL` → badge on detail + list row.
- Filter list `criticality=CRITICAL` → only matching products.
- Component detail shows no criticality field anywhere.

### 4. Sunset badges (US4)

- Set `sunsetAt` +60d on a product → neutral "Sunset {date}" badge.
- Set +10d → amber "Sunset in {n}d". Set a past date on an ACTIVE product →
  red "Sunset overdue"; product stays `ACTIVE` after the date passes.
- Retire the product → overdue styling clears (retired wins).

### 5. Importer non-clobber (FR-015)

- Set links/tags/sunsetAt on a component owned by an importer source.
- Run that importer → component's curated fields are unchanged.

### 6. Backward compatibility

- Products/components created before the migration render normally with
  empty metadata; PATCH with unrelated fields leaves metadata untouched.

## Automated checks

```text
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm --filter @componode/backend docs:api   # regenerate docs/api.md
```

Expected: all green; openapi contract test passes (new fields + params
registered); testcontainers integration covers migration columns, filters,
union validation, and the FR-015 reconcile case.
