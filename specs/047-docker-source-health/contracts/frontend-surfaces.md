# Contract: Frontend surfaces — ImporterSource UI, observation render, tag suggestions

No new backend endpoints. All reads/mutations use the existing
`/api/v1/importer-sources*` API (shipped in spec 044,
openapi.yaml:1820-1944) and `GET /components/{id}`.

## Routes & nav

| Route | Element | Access |
|---|---|---|
| `/sources` | `UxSourcesPage` → `SourcesView`/`SourcesTable` | `authed`, all roles |
| `/sources/$id` | `UxSourceDetailPage` → `SourceDetail` (tabs: overview, runs, memberships, activity) | `authed`, all roles |

Nav: third item `Importer sources` → `/sources` inside the existing
`"Sources"` section (`ux/lib/nav.ts:57-62`); `SEGMENT_LABELS` gains
`sources: "Sources"`. `routes.tsx` registers both next to the
importer/agent routes.

## Sources list (FR-004)

`SourcesTable` mirrors `agents-table`: `ListToolbar` (search on
identity/label + status filter `ACTIVE|UNMONITORED|RETIRED`), columns —
identity (`MonoValue`), importer (`importerProvider`), bound config
(link to `/importers/:id` or "—"), status (`StatusBadge` via
`SOURCE_STATUS_META`), last completed run (`RelativeTime`), memberships
counts; row click → `/sources/:id`. `EmptyState` explains Sources
appear when an importer reports source identity.

## Source detail (FR-005/006)

- **Overview tab**: `DescriptionList` — external identity, label,
  importer, bound config link, status, first/last seen, membership
  counts; `UNMONITORED`/`RETIRED` `Alert` explaining the state and that
  a config reporting the same identity rebinds on its next run
  (rebind-on-report — no manual binding).
- **Runs tab**: run-history `Table` (reuse `run-detail` columns:
  result, started/finished, assets, errors); run rows link to
  `/importers/:configId/runs/:runId` **only when `configId` non-null**.
- **Memberships tab**: two tables (components, instances) with
  name/externalId, `active` state, details summary; `truncated` notice
  at the 200-row cap.
- **Activity tab**: `useEntityHistory("importer_source", id)` — works
  today.
- **Danger zone** (`ADMIN` only via `canAccess`): Retire →
  `ConfirmDialog` → `POST /:id/retire`; `RETIRED` → Reactivate →
  `POST /:id/reactivate`; `409 SOURCE_STATE_CONFLICT` → error toast +
  invalidate. Retire/reactivate return the raw row — refetch the detail
  query afterward.

## Observation render (FR-001/003)

`component-detail.tsx` Instances table gains an expandable row (toggle
per row): renders `rawConfig.dockerObservation` allowlisted fields via
`DescriptionList` — state, exitCode, oomKilled, restarting, startedAt,
finishedAt, `health.status` (+`failingStreak`) or an explicit
"no health check configured" state. Absent `dockerObservation` →
expand control hidden/disabled (non-Docker instances unaffected).
Requires `rawConfig` on `api/types.ts ComponentInstance`,
`view-types.ts`, `mapComponentInstance`.

## Tag suggestions (FR-007)

In `component-edit-dialog.tsx`, below `TagsInput`: suggestion chips
(`Badge` + accept icon) computed from `component.details`:

```text
candidates = []
if details.composeProject valid per tagSchema:
    candidates += `compose:${project}`
if details.composeProject && details.composeService and
   `service:${project}.${service}` valid per tagSchema:
    candidates += `service:${project}.${service}`
candidates = candidates − component.tags
```

- Import `tagSchema` from `@componode/core` (precedent:
  `PASSWORD_MIN_LENGTH` import in `register.tsx`) — transform
  (trim/lowercase) then validate; failing values are simply not offered
  (never truncated).
- Accept chip → `onChange([...tags, candidate])`; nothing is written
  until the user saves the edit.
- Hidden when no candidates (non-Compose/standalone/non-Docker
  components unchanged).

## OpenAPI sync (ADR-104)

`GET /components/{id}` response already embeds `instances` — document
it plus a `ComponentInstance` schema (incl. `rawConfig`) in
`docs/openapi.yaml`. No route/permission changes.
