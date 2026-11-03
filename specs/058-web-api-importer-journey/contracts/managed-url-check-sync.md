# Contract: Managed URL Check synchronization

## Ownership

- ImporterConfig scope is canonical for importer-managed check definitions.
- `url_checks` rows are materialized scheduler/runtime state; observations
  remain in `url_check_observations`.
- Importer packages do not persist checks. Core uses the validated config
  scope while it processes each `DiscoveredAsset`.
- A typed `source_url_check_memberships` record links each ImporterSource to
  the stable managed check key and materialized URL Check.

## Import-run behavior

1. The importer reports `collection:<sourceKey>` before its first yield,
   including an empty inventory.
2. It yields one `DiscoveredAsset` per Component profile and includes all
   configured ComponentInstances. `DiscoveredAsset` has no Check field.
3. The importer performs one one-shot request to the instance URL for
   discovery details and initial status. An endpoint-level response/transport
   failure becomes an `ERROR` instance result and does not abort siblings.
4. Core upserts Component/instance data by stable keys and synchronizes the
   check definition in the per-asset transaction. Check IDs and observations
   remain stable on ordinary edits.
5. If the same ComponentInstance/check key is reported by another Source,
   an identical definition adds a Source membership to the existing check.
   A different definition is rejected; last-writer-wins is forbidden.
6. A run becomes `COMPLETED` only after every configured row has been
   evaluated and then reconciles its Source memberships. Fatal/incomplete
   runs remain `FAILED` and do not reconcile.

## Shared check state

A URL Check is scheduled when at least one Source membership:

- is active,
- belongs to an `ACTIVE` Source with an enabled bound ImporterConfig, and
- has `configuredEnabled = true`.

One paused/removed owner does not pause a shared check while another effective,
enabled Source still declares the same key. Conflicting definition updates
return a controlled conflict and make no partial changes.

## Config lifecycle

| Event                                                       | Managed check behavior                                                                                   |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| ImporterConfig disabled                                     | Pause that Source's memberships; other enabled owners may keep a shared check active                     |
| Explicit config re-enable                                   | Re-enable configured-enabled checks for that Source and reset the failure streak/auto-disable marker     |
| Ordinary import run                                         | Reconcile definitions and memberships but preserve an auto-disabled check's runtime disabled state       |
| ImporterConfig deleted                                      | Source becomes `UNMONITORED`; pause its memberships and preserve definitions/observations                |
| Config recreated and Source reattached                      | Reuse the same Source and check keys; resume configured-enabled checks on the explicit enable transition |
| Endpoint absent from a completed run                        | Deactivate the reporting Source's membership                                                             |
| Instance becomes `GONE` with no effective Source membership | Delete the managed URL Check and all its observations                                                    |
| Instance remains shared                                     | Preserve the shared check/history; only effective enabled owners schedule it                             |

## ComponentInstance status

- Before the first URL Check observation, importer status is the initial
  ComponentInstance status.
- After the first URL Check observation, managed Check outcomes are
  authoritative; later importer-run status values are ignored.
- `SUCCESS` writes `RUNNING`; `FAILURE` writes `ERROR`.
- `MISSED`, no-data, and disabled states preserve the last status.
- `GONE` from Source reconciliation and `RETIRED` Component lifecycle cannot be
  overwritten by a probe.
- Status updates are written only on transition and audited with the existing
  `component_instance` change model. Product health reads the updated status
  through ADR-112's unchanged rollup.

## Migration behavior

- Promote the unique legacy URL Check whose canonical URL matches the
  ComponentInstance URL, preserving its ID and observation history.
- Disable and retain extra legacy checks.
- If no unique match exists, create a default managed Check; retain legacy
  definitions/history disabled and read-only.
- Migration is one-to-one per old config and is idempotent. Ambiguous Source
  or Component provenance is reported for resolution; no batch merge, split,
  or silent rekey is allowed.
