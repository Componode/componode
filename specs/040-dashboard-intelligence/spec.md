# Feature Specification: Dashboard Intelligence — Stat Deltas, Attention Detail, Agent Enrolled-By

**Feature Branch**: `040-dashboard-intelligence`

**Created**: 2026-10-31

**Status**: Draft

**Input**: Gap-registry items G23, G24, and G25 (`researches/ux-rewrite-gaps.md`). The UX conformance pass (spec 038) shipped flag-gated dashboard surfaces — a `+N this week` line on the stat grid, a `detail` sub-line on attention rows plus a `CREDENTIAL_EXPIRING` kind the card copy already promises, and an "Enrolled by" agent-detail header — that render nothing because the backend payloads omit the underlying data. This spec ships the backend capability so the flags can flip ON and the fallback copy comes down.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Attention queue explains itself and warns about expiring credentials (Priority: P1)

An operator opening the dashboard sees each "Needs attention" row carry a one-line `detail` explaining *why* the item needs action — e.g. "Last heartbeat 2h ago · heartbeat_timeout" on an offline agent — and a new `CREDENTIAL_EXPIRING` row for credentials nearing or past `expiresAt` (e.g. "kubeconfig token — expires in 3d"). The card description already promises "expiring secrets" (spec 038 copy) but the API never emits the kind, and `detail` is always null.

**Why this priority**: The attention queue is the dashboard's action surface; a row without context forces the operator to click through just to learn severity. Expiring credentials are the only silent failure mode left — a token that lapses kills the importer configs bound to it with no warning anywhere in the product.

**Independent Test**: `GET /dashboard/summary` returns `detail` strings on attention rows that have context and emits `CREDENTIAL_EXPIRING` items for credentials inside the expiry warning window; the attention list renders both with `attentionDetail`/`credentialExpiring` ON.

**Acceptance Scenarios**:

1. **Given** an OFFLINE_AGENT row for an agent whose last heartbeat was 2h ago with `heartbeat_timeout`, **When** the list renders, **Then** the row shows a `detail` sub-line conveying last-contact time and disconnect reason.
2. **Given** a credential whose `expiresAt` is 3 days out, **When** the dashboard loads, **Then** a `CREDENTIAL_EXPIRING` row appears (warning tone) linking to the credential, with detail conveying time-to-expiry.
3. **Given** a credential already past `expiresAt`, **When** the dashboard loads, **Then** a `CREDENTIAL_EXPIRING` row appears conveying that it has expired.
4. **Given** a credential with `expiresAt` beyond the warning window or null, **When** the dashboard loads, **Then** no `CREDENTIAL_EXPIRING` row is emitted for it.
5. **Given** an attention row with no extra context (e.g. `PRODUCT_ERROR`), **When** the list renders, **Then** `detail` is null and the row renders exactly as today — no fabricated line.

### User Story 2 - Stat grid shows week-over-week deltas (Priority: P1)

An operator scanning the stat grid sees a `+N this week` line under the Products, Components, and Instances counts — the sub-line the spec-038 UI renders behind `statDeltas`. The Active-importers card shows an importer-health summary instead ("All healthy" when nothing importer-related needs attention).

**Why this priority**: "What changed since last week" is the dashboard's stated purpose ("what changed across your catalog since your last visit"); the count alone can't answer it. The flag scaffolding is already in place — the missing piece is a per-card delta in the summary payload.

**Independent Test**: `GET /dashboard/summary` returns per-stat deltas (rows created in the trailing 7 days); the stat grid renders `+N this week` with `statDeltas` ON and the importers card renders its health summary.

**Acceptance Scenarios**:

1. **Given** 3 products created in the last 7 days, **When** the dashboard renders, **Then** the Products card shows `+3 this week`.
2. **Given** zero components created in the last 7 days, **When** the dashboard renders, **Then** the Components card shows the defined zero-delta rendering (`+0 this week`), not a hidden or fabricated line.
3. **Given** the delta population, **When** deltas are computed, **Then** they mirror the headline totals' population rules (components: ACTIVE; instances: non-GONE) so `+N` and the count above it measure the same set.
4. **Given** no importer-related attention items, **When** the dashboard renders, **Then** the Active-importers card shows "All healthy" rather than a numeric delta or "—".

### User Story 3 - Agent detail shows who enrolled it (Priority: P2)

An admin on an agent's detail page sees "Enrolled by {name} on {date}" in the header — attribution the spec-038 UI renders behind `agentEnrolledBy`. A pending-enrollment alert can also show when the enrollment token expires via `enrollmentExpiresAt`.

**Why this priority**: Attribution is audit-grade context for a security-sensitive entity (the enrollment token is a credential-issuing secret), but it is presentation-only — no operator action depends on it. `import_agents.createdBy` already stores the actor's user id; the missing piece is resolving it to a displayable name on the read.

**Independent Test**: `GET /agents/:id` returns the enrolling user's display name as `createdBy` (and `enrollmentExpiresAt` while a pending enrollment token exists); the header renders "Enrolled by …" with the flag ON.

**Acceptance Scenarios**:

1. **Given** an agent created by user "Ada Admin", **When** the detail page renders, **Then** the header shows "Enrolled by Ada Admin on {createdAt}".
2. **Given** an agent whose `createdBy` is null or no longer resolvable (legacy row, deleted user), **When** the detail page renders, **Then** the API returns `createdBy: null` and the header falls back to "Created {date}" — never a raw uuid.
3. **Given** an agent with a live pending enrollment token, **When** `GET /agents/:id` returns, **Then** `enrollmentExpiresAt` carries the token's expiry; once the token is used or expired it returns null.

---

### Edge Cases

- Delta window is the **trailing 7 days** (rolling window matching the "+N this week" label), not the calendar week — a count computed at read time, consistent with the rest of the read-only summary (ADR-094: the GET stays side-effect-free).
- `CREDENTIAL_EXPIRING` uses the same 30-day warning window the credentials UI already applies (G5 convention); already-expired credentials are included — expired is strictly worse than expiring.
- Credentials with `expiresAt: null` never emit `CREDENTIAL_EXPIRING`.
- Ranking: `CREDENTIAL_EXPIRING` is a warning-tone kind ranked below the operational failure kinds (FAILED_RUN / PRODUCT_ERROR / INSTANCE_* / OFFLINE_AGENT) but **above** the display-only sunset items (ADR-116's "ranked above the sunset kinds" precedent for actionable kinds); expiring rows order among themselves by soonest `expiresAt`. The 20-row `ATTENTION_LIMIT` still applies across the merged queue.
- `detail` strings are composed server-side from data already fetched for the row (no extra N+1 per row); kinds with nothing meaningful to add return `detail: null` rather than restating the label.
- Delta counts respect the same exclusion rules as the headline totals: RETIRED components and GONE instances created in the window do not inflate the delta.
- `createdBy` resolution joins the users table at read time; if the actor was deleted or the column is null, the field is null — the API never returns a raw user id as a name.
- `enrollmentExpiresAt` reflects the *live* pending token only (unused + unexpired); it must never expose the token hash or any secret material.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `GET /dashboard/summary` MUST return `deltas` with `products`, `components`, and `instances` counts of rows created in the trailing 7 days, computed in the same read (no per-row N+1) and scoped to the same populations as the headline totals (components: `ACTIVE`; instances: non-`GONE`).
- **FR-002**: Every `AttentionItem` MUST carry `detail: string | null` — a short human-readable context line composed server-side (e.g. last-heartbeat + disconnect reason for `OFFLINE_AGENT`, expiry distance for `CREDENTIAL_EXPIRING`, error context for `FAILED_RUN`), or null when the kind has nothing to add.
- **FR-003**: `GET /dashboard/summary` MUST emit `CREDENTIAL_EXPIRING` attention items for credentials whose `expiresAt` is already past or within the 30-day warning window — warning tone, `href` to the credential, `at` = `expiresAt`, ranked below operational failure kinds.
- **FR-004**: `GET /agents/:id` MUST return `createdBy` — the enrolling actor's display name resolved from `import_agents.createdBy` at read time (null when the column is null or the user is unresolvable) — and `enrollmentExpiresAt`, the live pending enrollment token's expiry or null.
- **FR-005**: The frontend MUST wire the new fields (`summary.deltas` → `StatGrid`, `item.detail` → `mapAttentionItem`, `agent.createdBy`/`enrollmentExpiresAt` → `mapImportAgent`) and flip `statDeltas`, `attentionDetail`, `credentialExpiring`, and `agentEnrolledBy` to `true`, removing the flag-off fallbacks the flags only ever gated.
- **FR-006**: The rendered output MUST match the v0 prototype design the spec-038 UI already implements — `+N this week` sub-lines, "All healthy" for the importers card, truncated detail sub-line, "Enrolled by {name}" header — no new presentation work beyond wiring now-live fields.
- **FR-007**: `docs/openapi.yaml` MUST be updated in the same change (ADR-104): `AttentionItem.detail`, `CREDENTIAL_EXPIRING` in the kind enum, `DashboardSummary.deltas`, and the new `ImportAgent`/`AgentDetail` fields — the enum extension is a contract-surface change and follows the ADR-fidelity rule (ratify at plan time).
- **FR-008**: Gap-registry entries G23, G24, and G25 MUST be marked resolved (flags flipped, spec number recorded) per the gap-governance rule in `docs/ux.md` §7.

### Key Entities

- **`digital_products` / `components` / `component_instances`**: delta sources — rows `createdAt` within the trailing 7 days inside each headline population.
- **`credentials`**: `expiresAt` drives `CREDENTIAL_EXPIRING` emission and its `detail` line.
- **`import_agents`**: `createdBy` (user id → display name) and `enrollmentTokenExpiresAt` (live pending token) feed `GET /agents/:id`.
- **`import_runs` / `agent_sessions`**: context for `detail` on `FAILED_RUN` / `OFFLINE_AGENT` rows (error info, last-contact, disconnect reason).
- **Flag off-ramps**: `statDeltas`, `attentionDetail`, `credentialExpiring`, `agentEnrolledBy` in `ux/lib/flags.ts` — flipped ON; fallback rendering deleted where the flag was only ever the off-switch.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The dashboard stat grid renders a real `+N this week` line under Products, Components, and Instances, and an importer-health line under Active importers — zero permanently-empty sub-lines.
- **SC-002**: Every attention row with available context renders its `detail` sub-line; credentials inside the 30-day window (or expired) produce `CREDENTIAL_EXPIRING` rows — zero silent credential lapses.
- **SC-003**: Agent detail renders "Enrolled by {name}" for agents with a resolvable creator and the honest "Created {date}" fallback otherwise — never a raw uuid.
- **SC-004**: `GET /dashboard/summary` and `GET /agents/:id` compute all new fields in their existing queries plus at most one grouped aggregate each — no per-row N+1 — verified by integration test or query inspection.
- **SC-005**: G23, G24, and G25 are closed in `researches/ux-rewrite-gaps.md` (flags flipped/removed, spec recorded); `flags.ts` has no new unconsumed keys.
- **SC-006**: Frontend and backend suites stay green; each shipped field has a regression/integration test.

## Assumptions

- The v0 prototype's dashboard surfaces (`+N this week`, detail sub-lines, "Enrolled by") are the design target; `docs/ux.md` wins conflicts.
- "This week" means the trailing 7 days — a rolling window, consistent with the relative-time language used across the UX.
- The 30-day credential-expiry warning window from G5 (already the credentials-table convention) is the `CREDENTIAL_EXPIRING` threshold — ratified convention, not invented here.
- `createdBy` is resolved to a display name server-side (like audit `createdByName`); the raw user id never reaches the client as the "Enrolled by" value.
- The spec-038 UI (flag gates, sub-line rendering, card copy) is the consumer — this spec is backend-data + flag-flip only, no new UX surface.
- The `CREDENTIAL_EXPIRING` kind extends the documented `AttentionItem.kind` enum in `docs/openapi.yaml`; whether that enum needs an ADR amendment (ADR-fidelity rule) is decided at plan time.
