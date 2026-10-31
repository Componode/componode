### ADR-035 — Instance reconciliation: orphan missing instances

> **Status:** Ratified

**Context**: An importer yields a component with `instances[]`. What happens to
instance rows from a previous run that are absent from the current yield?

**Decision**: **Orphan the missing instances — set `status = GONE`, keep the
row, add `lastSeenAt`/`lastSeenInRunId`.** Re-appearance next run flips
`status` back.

**Rationale**: Matches ServiceNow CMDB, cartography, AWS Config (retain
retired records with status flip, not hard-delete). Resilient to transient API
failures. Preserves blast-radius/audit value. `ComponentInstance.status` gains
`GONE` ([ADR-014](./ADR-014-environment-separate-componentinstance-entity.md)'s `...` was always meant to grow).
## Amendment 1 — Orphaning scoped to source memberships (2026-10-31, via ADR-119)

**Context**: The original decision orphans any instance row absent from
the current yield — written when each importer config was the only
provenance axis. [ADR-119](./ADR-119-importer-source-identity-and-lifecycle.md)
makes the durable Source membership the reconciliation unit, so
"absent" must be evaluated per Source.

**Refinement**: "Orphan the missing instances" now applies **within the
reporting Source's own instance memberships**: a `COMPLETED` run marks
`GONE` only memberships that Source no longer reports. An instance stays
non-`GONE` while any other Source still reports it; `GONE` (and the
re-appearance flip back) is decided over the union of active Source
memberships, not a single run's yield. See
[ADR-036](./ADR-036-two-phase-reconciliation-scope.md) Amendment 1.

---

**Amended by ADR-119**: instance orphaning is scoped to the reporting
Source's memberships — `GONE` requires no remaining active membership;
see Amendment 1.
