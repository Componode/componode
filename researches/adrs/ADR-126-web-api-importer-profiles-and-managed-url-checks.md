# ADR-126 — Web/API importer profiles and importer-managed URL Checks

> **Status:** Ratified (2026-11-03)
> **Spec:** `specs/058-web-api-importer-journey`
> **Amends:** ADR-014, ADR-037, ADR-047, ADR-054, ADR-071, ADR-077, ADR-103, ADR-112, ADR-119, ADR-123, ADR-124, ADR-125

## Context

The Web URL and API URL importers each accept one URL, which produces one
Component and one ComponentInstance. The reviewed journey requires one
ImporterConfig to describe multiple logical Component profiles and their
environment-specific ComponentInstances, with one managed URL Check per
instance. The supplied draft placed monitoring inside importer runs; this ADR
retains the URL Check scheduler and observation history while making importer
configuration the source of truth for the managed check definitions.

The status model also changes: URL Check outcomes will update the operational
status of monitored ComponentInstances and therefore the existing derived
Product health rollup. Importer and check ownership must remain distinguishable
so source reconciliation, check cleanup, and multiple Sources reporting the
same instance stay deterministic.

## Decision

1. **Collection configuration.** `web-url` and `api-url` configurations contain
   one or more Component profiles. Each profile has a stable `componentKey`,
   an editable display name (initially suggested from its URL host), and one or
   more instances. Each instance has a stable `instanceKey`, an environment,
   and its ComponentInstance URL. Each configured instance declares exactly
   one managed URL Check; that check may override the instance URL with a
   separate health-check URL. Its method is `GET` or `HEAD`; `POST` is not
   supported. Authenticated checks are limited to Components in the `API`
   category and reuse the existing Credential/key-name contract. Check cadence
   and vantage defaults remain on the Component monitoring setup; individual
   checks may override cadence.

2. **Stable identity.** A collection receives a generated immutable
   `sourceKey` when its ImporterConfig is created. The Source identity is
   `collection:<sourceKey>` and is independent of the editable config label,
   profile names, and URL list. Recreating a config can explicitly reattach an
   existing ImporterSource and reuse its key. `componentKey` and `instanceKey`
   are stable opaque identifiers, independent of display name, environment,
   and URL edits. Reusing the same stable Component/instance/check keys across
   Sources denotes shared records; incompatible definitions for a shared key
   are rejected rather than resolved by last-writer-wins.

3. **Migration of existing configs.** Each existing one-URL config migrates
   one-to-one to a profile with one instance; existing configs are not
   automatically merged. The migration preserves Component, ComponentInstance,
   ImporterSource, URL Check, and observation identities where their provenance
   is unambiguous. The existing ImporterSource row is retained and rekeyed to
   its generated collection identity. Stable profile/instance keys are seeded
   from the existing external identities. If one existing URL Check matches
   the ComponentInstance URL, that check and its history become the managed
   check. Other legacy checks are disabled but retained. If the match is
   absent or ambiguous, a default managed check is created and the old checks
   remain disabled and readable. The migration never merges distinct configs
   or Source rows.

4. **Importer output and persistence ownership.** An importer yields one
   `DiscoveredAsset` per Component profile, containing its configured
   ComponentInstances. Importer packages remain pull-only and never write
   check or catalog records. The core uses the validated ImporterConfig scope
   to synchronize profile/instance inventory and managed URL Check definitions
   in the import-run path. The `DiscoveredAsset` contract remains free of
   monitoring records. Importers report the collection Source identity before
   their first yield, including on an empty inventory.

5. **Managed check records.** The importer configuration is canonical for
   managed check definitions. Core materializes each definition as a durable
   `url_checks` row; `url_check_observations` remains the source of monitoring
   history and is written by the independent URL Check scheduler. A typed
   Source-to-URL-Check membership record associates a managed check with every
   Source that declares its stable check key. A ComponentInstance/check-key
   pair has at most one managed URL Check. Identical shared definitions use
   that one check and observation stream; conflicting definitions fail before
   they can overwrite the shared record. No polymorphic `edges` table is
   introduced.

6. **Status and Product health.**
   - The importer keeps its one-shot request on each configured URL for
     discovery details and the initial ComponentInstance status.
   - Once a managed URL Check has recorded its first observation, it is the
     authoritative status source for that monitored ComponentInstance.
     Subsequent importer-run status values do not overwrite the check-driven
     status, although the importer continues its one-shot discovery request.
   - `SUCCESS` sets `ComponentInstance.status = RUNNING`; `FAILURE` sets it to
     `ERROR`. `MISSED`, no-data, and disabled states preserve the last
     ComponentInstance status. Source reconciliation alone sets `GONE`, and a
     URL Check cannot revive a `GONE` instance or update an instance on a
     `RETIRED` Component.
   - Status changes are written only on transition and use the existing
     `component_instance` audit model. Product health continues to use the
     ADR-112 aggregation over current ComponentInstance statuses; it therefore
     reflects URL Check results for monitored instances.

7. **Run completion and reconciliation.** The import-run status set does not
   gain `PARTIAL`. Every configured profile and instance is evaluated:
   endpoint response or transport failures are represented on that instance
   as `ERROR`, and the run is `COMPLETED` after the complete configured
   inventory has been evaluated. A config, execution, or other fatal run
   failure remains `FAILED`; only `COMPLETED` runs reconcile Source
   memberships. Importer runs and URL Check schedules remain distinct
   schedules.

8. **Source and check lifecycle.**
   - Disabling an ImporterConfig pauses its managed check memberships. A
     check shared by multiple Sources remains scheduled while any effective,
     enabled Source membership still declares it.
   - An explicit ImporterConfig disabled-to-enabled transition re-enables the
     configured checks whose definitions are enabled and resets their
     consecutive-failure streak. Ordinary import runs never clear an
     auto-disable state.
   - Deleting an ImporterConfig leaves its ImporterSource `UNMONITORED` and
     pauses its managed checks while preserving check definitions and
     observations. Reattachment to the same generated sourceKey restores the
     binding.
   - A configured endpoint removed from a fully completed inventory loses
     only the reporting Source's membership. If no effective Source membership
     remains, the ComponentInstance becomes `GONE`; its managed URL Check and
     observations are deleted. A shared ComponentInstance and its shared check
     remain while another effective Source reports them.

9. **Authoring and API surface.**
   - Importer UI is the only new authoring surface for managed check
     definitions. Component detail displays managed check status, summaries,
     and history read-only and links to the owning ImporterConfig.
   - Legacy manually authored URL Checks are disabled during migration and
     retained read-only. New manual URL Check authoring is out of scope.
   - Direct URL Check `POST`, `PATCH`, and `DELETE` routes remain documented
     as deprecated but reject writes with HTTP `410` and
     `URL_CHECK_WRITE_DEPRECATED`. URL Check read routes and per-Component
     monitoring-setup controls remain available.
   - Manual Component/ComponentInstance creation remains available, but
     `POST /components` no longer accepts a `monitoring` block or creates
     checks. Supplying that block receives the same deprecated-write error.
   - The nested profile/instance builder is an approved custom importer-form
     control for these two importers; it does not establish a general
     schema-renderer convention for arbitrary nested importer scopes.

## Consequences

- The importer config schema gains stable collection/profile/instance/check
  keys, and its v2 migration is explicit; changing the manifest `version`
  alone does not migrate stored `scope`.
- The core gains source-scoped check-definition synchronization and a typed
  Source-to-URL-Check membership table. The URL Check read model must
  distinguish importer-managed checks from disabled legacy records.
- The URL Check scheduler becomes a writer to `ComponentInstance.status`.
  Product health and every surface that reads instance status must use the
  updated status semantics.
- `POST /components` monitoring input and URL Check write routes are breaking
  API changes; `docs/openapi.yaml`, generated `docs/api.md`, controlled error
  codes, and compatibility tests change together under ADR-104.
- `docs/url-checks.md`, `docs/importers/web-url.md`,
  `docs/importers/api-url.md`, `docs/using-the-catalog.md`, `docs/ux.md`,
  and the relevant feature flags/gap registry entries must describe the
  importer-owned editing path, source lifecycle, status propagation, and
  legacy-check behavior.

## Amendments to earlier ADRs

- **ADR-014** — a URL Check may update a monitored ComponentInstance's
  operational status under item 6; `GONE` remains exclusively controlled by
  reconciliation.
- **ADR-037** — endpoint failures represented on evaluated instances do not
  make a complete configured inventory `PARTIAL`; only an incomplete/fatal
  run skips phase-2 reconciliation.
- **ADR-047** — ImporterConfig deletion also pauses, but preserves, its managed
  URL Check definitions and observations.
- **ADR-054** — direct URL Check writes are deprecated/read-only; managed
  check changes use ImporterConfig permissions, while existing
  `monitoringSetup:update` and Credential/Agent selector permissions remain.
- **ADR-071** — add `URL_CHECK_WRITE_DEPRECATED` (HTTP 410) to the controlled
  error-code set.
- **ADR-077** — add `url_checks.managedKey` and typed
  `source_url_check_memberships` to the schema inventory.
- **ADR-103** — approve the nested Web/API profile builder as a scoped custom
  importer-form control and the new read-only Component Relationships tab.
- **ADR-112** — the existing rollup formula is unchanged, but its input
  ComponentInstance statuses may now be written by URL Check observations.
- **ADR-119** — permit a generated, durable collection key for a
  user-configured multi-endpoint source and source-scoped URL Check
  memberships.
- **ADR-123** — importer scope owns managed check definitions, while URL
  Check records, scheduling, and observations remain distinct from importer
  runs; URL Check outcomes update ComponentInstance status.
- **ADR-124** — an explicit ImporterConfig re-enable is the manual re-enable
  action for its configured checks and resets their failure streak.
- **ADR-125** — remove manual create-with-checks from `POST /components`;
  ordinary Component creation and focused first-instance recovery remain.

## Rationale

ImporterSource remains the provenance boundary for catalog inventory, while
the URL Check scheduler remains the history and measurement boundary for
monitoring. Making ImporterConfig the canonical definition source gives the
Web/API collection builder one place to manage profiles, instances, and their
checks without letting importer packages write the database or turning
monitoring observations into import runs. Stable keys make renames and URL
changes idempotent; Source memberships preserve shared records and make
endpoint cleanup safe. The status propagation is an explicit change from the
previous separation: the user wants the status used by Product health to
reflect the latest executed monitor result, while monitor-side `MISSED` slots
remain distinct and do not manufacture an endpoint failure.

## Alternatives considered

- **Keep one URL per importer config** — rejected for this journey; it forces
  one config and Source per environment/endpoint.
- **Let importer packages write `url_checks` directly** — rejected by
  Constitution Principle II; the core performs synchronization.
- **Make importer runs the URL Check scheduler** — rejected; URL Check
  schedules, observations, bounds, and retention remain independent.
- **Use the editable config label or URL-set hash as Source identity** —
  rejected; renames and endpoint-list edits must not create new Sources.
- **Add `PARTIAL` to the ImportRun status enum** — rejected; a completed
  configured inventory contains an explicit result for each endpoint, while
  fatal/incomplete runs remain `FAILED` and do not reconcile.
- **Retain manual URL Check authoring** — rejected for this product flow;
  existing records are disabled/read-only, and new definitions come through
  the Importer UI.
