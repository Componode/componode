# Quickstart: validating schema-driven importer forms

## Prerequisites

- `pnpm install && pnpm build` at repo root
- Dev stack running (`docker compose up` or `pnpm dev`), logged in as an
  admin (importer config create needs `importer:config:create`)

## Automated

```bash
pnpm --filter @componode/frontend test   # scope-schema + importer-form suites
pnpm typecheck && pnpm lint
```

Expected: `scope-schema.test.ts` covers every mapping-table row +
unknown-key split; `importer-form-scope.test.tsx` covers typed render,
required block, default prefill/submit, JSON toggle round-trip,
importer-switch reset, unknown-keys block.

## Manual end-to-end

1. Importers → **New importer** → pick **GitHub**: `org` text input
   marked required, `baseUrl` URL input, `repos` list editor,
   `billingPeriod` dropdown, `include*` switches pre-set to schema
   defaults, `environmentMapping` as a labeled JSON field. No JSON for
   the whole scope.
2. Submit with `org` empty → inline error on `org`, no request fires.
3. Fill `org`, save → detail page's scope shows the entered value plus
   materialized defaults (e.g. `includeOrganization: true`).
4. Re-open the config → all fields pre-populated from stored scope.
5. Importers → **New importer** → pick **Web URL**: single URL field.
6. Toggle **Edit as JSON** → textarea holds the current scope; edit a
   value, toggle back → typed fields reflect it.
7. Switch GitHub → Kubernetes mid-create → GitHub keys are gone;
   Kubernetes defaults render.
8. DB-edit a config's `scope` to add a bogus key → edit form shows an
   "Unrecognized fields" JSON block containing it; save keeps it
   (Alibaba's strict schema then surfaces the server error on save).

## Regression checks

- `POST /importer-configs` payload `scope` is the same shape as the old
  JSON editor produced — diff the network body.
- All 8 importers completable without typing JSON (except
  `environmentMapping`, intentionally JSON).
