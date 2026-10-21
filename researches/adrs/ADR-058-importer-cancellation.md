### ADR-058 — Importer cancellation

> **Status:** Ratified

**Context**: [ADR-056](./ADR-056-importer-interface-signature.md) added `signal: AbortSignal` to the context. How does
cancellation flow?

**Decision**: **`AbortController` for live signal + `cancelRequestedAt` column
on `import_runs` for durability.** The cancel endpoint sets
`cancelRequestedAt` (durable record) AND calls `controller.abort()` (immediate
signal). The importer observes the `AbortSignal` for mid-SDK-call interruption
(passes `signal` to `fetch`/`@aws-sdk`/`octokit` natively). On backend restart,
the recovery loop: `status = RUNNING AND cancelRequestedAt IS NOT NULL` →
`CANCELLED`; `status = RUNNING AND cancelRequestedAt IS NULL` → `INTERRUPTED`.

**Rationale**: Two mechanisms serve different failure modes (live cancel vs.
crash recovery). `AbortController` is the right primitive for immediate,
mid-SDK-call interruption. `cancelRequestedAt` is the right primitive for
durability — if the backend crashes between the cancel API call and the abort
reaching the importer, the flag survives. The distinction matters for the
audit log ([ADR-052](./ADR-052-audit-model-three-tier.md)): "admin cancelled run X" vs. "backend crashed during run
X" are different operational events.

---

**Amended by ADR-116**: cancellation extends across the process boundary
— the hub sets `cancelRequestedAt` and sends a `cancel` frame that fires
the agent's `AbortController`. `cancelRequestedAt` remains the source of
truth.