# Feature Specification: Component Check Summary — at-a-glance availability and latency on the Component checks table

**Feature Branch**: `053-component-check-summary`

**Created**: 2026-11-02

**Status**: Shipped

**Input**: User description: "Component overview (G2) · P2 — from `researches/url_check_monitoring_gap_analysis.md`: add compact availability/latency metrics to the Component checks table, label window/vantage/coverage, and eliminate the one-observations-request-per-row fan-out."

## Clarifications

### Session 2026-11-02

- Q: Which rolling window should the compact table summary cover? → A: 24 hours — the shortest ratified window, matching the detail page's first metric column and the research's "recent availability" intent; fixed, not user-selectable on the table. (Ratifies FR-001/FR-003.)
- Q: Which latency figure should each check row display for the 24-hour window? → A: p95 — tail latency as the single at-a-glance figure; the full p50/p95/p99 set stays on the detail page. (Ratifies FR-002.)
- Q: Should the recent-outcome dot strip remain in the table next to the new windowed figures? → A: Keep dots + summary — the dots keep per-observation granularity and ride in the same bounded payload. (Ratifies FR-008.)

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Compact windowed summary per check row (Priority: P1)

An operator opens a Component's detail page and, without clicking into each check, sees for every URL Check row a compact availability figure and a compact latency figure computed over the rolling 24-hour window, alongside the existing name/URL, instance, check status, latest result, last-checked time, and recent-outcome strip. The summary is labeled with its window and phrased as "reachable from" the configured execution vantage — never as global availability.

**Why this priority**: This is the gap the feature exists to close. Today the windowed metrics live one click deep on each check's detail page; an operator triaging a Component with many checks must open each one to learn whether it is broadly healthy. The table already shows identity and the latest single result — the windowed summary is the missing operational context.

**Independent Test**: seed a Component with checks that have recorded observations, open the Component detail page, and verify every row shows a windowed availability figure and a windowed latency figure with a visible window label and vantage phrasing — without opening any check detail page.

**Acceptance Scenarios**:

1. **Given** a check with recorded observations in the recent window, **When** the Component checks table renders, **Then** the row shows the check's availability percentage for that window computed under the check's success policy (scheduled-but-missed probes count as unsuccessful).
2. **Given** a check with successful observations in the recent window, **When** the Component checks table renders, **Then** the row shows a latency figure for that window consistent with the check's detailed latency percentiles.
3. **Given** any displayed summary figure, **When** it renders, **Then** the display states or labels the time window it covers and conveys that the figures mean "reachable from" the Component's execution vantage.
4. **Given** a Component whose monitoring setup runs on an Import Agent, **When** the summary renders, **Then** the vantage is identifiable as that agent, consistent with how the rest of the card phrases vantage.

---

### User Story 2 - Bounded read path for the whole table (Priority: P1)

The Component checks table loads its complete display — check list, latest result, recent-outcome strip, and windowed summary for every row — through a bounded read path whose request count does not grow with the number of checks. Loading a Component with twenty checks issues the same small constant number of monitoring-data requests as loading one with a single check.

**Why this priority**: The current table issues one observations request per rendered row to draw the recent-outcome strip. Extending the same pattern to windowed metrics would multiply the fan-out further; the summary must arrive through the same bounded path that replaces it. This is a correctness-of-architecture requirement, not just a performance nicety — the fan-out is what the gap analysis flags for elimination.

**Independent Test**: load the Component detail page for a Component with many checks while observing network activity, and verify the number of monitoring-data requests is constant regardless of check count, with no per-check observations request issued by the table.

**Acceptance Scenarios**:

1. **Given** a Component with multiple URL checks, **When** the checks table loads, **Then** every row's recent-outcome strip and windowed summary are populated without a per-check observations or metrics request.
2. **Given** a Component with no checks, **When** the card renders, **Then** the existing empty state appears and no summary data is requested.
3. **Given** the table's data payload, **When** the same check's detail page is opened, **Then** the check's full rolling-window metrics and observation history still load through the existing detailed read path unchanged.

---

### User Story 3 - Honest empty, partial, and degraded states (Priority: P2)

The summary never invents data. A check with no observations in the window shows a clear "no data" presentation rather than a misleading 0% or 100%; a window where scheduled probes did not run (monitor-side coverage gap) is visually distinguishable from a window of genuine endpoint failures, so an operator can tell "the monitor was down" from "the endpoint is down".

**Why this priority**: A wrong-looking number is worse than no number — an all-missed window rendered as a plain "0% available" would tell the operator the endpoint is broken when the monitor itself was. This preserves the coverage-gap distinction already ratified for the detail page, applied to the compact surface.

**Independent Test**: create a fresh check with no observations and a check whose recent window contains only missed slots; verify the first shows an explicit no-data state and the second reads as a coverage gap rather than a plain endpoint failure.

**Acceptance Scenarios**:

1. **Given** a check with zero recorded observations, **When** its row renders, **Then** the summary shows an explicit no-data presentation — never a fabricated availability or latency figure.
2. **Given** a check whose window contains missed scheduled probes, **When** the row renders, **Then** the coverage gap is distinguishable from endpoint failures in the compact summary.
3. **Given** a disabled check, **When** its row renders, **Then** its existing disabled presentation holds and its summary either reflects recorded history or the no-data presentation — it never implies the check is still probing.
4. **Given** a Component with many checks, **When** the table renders, **Then** every row's summary is present without degraded or truncated display.

---

### Edge Cases

- **Brand-new check, first probe not yet run** — the row shows the no-data state; once the first observation lands, the summary reflects the partial window honestly.
- **Window contains only missed slots** — displayed as a coverage gap, not as "0% available" endpoint failure; the underlying availability formula still counts misses as unsuccessful, but the presentation keeps the two causes separable.
- **Very few observations in the window** — figures render over whatever observations exist (the window is rolling, not wait-until-full); a low observation count does not blank the summary.
- **Check with no successful observations but some failures** — availability shows its true low value and the latency figure shows its no-data state, since latency percentiles are defined over successful responses only.
- **Check disabled or Component/ComponentInstance retired** — recorded history still summarizes; the row keeps its existing lifecycle/status presentation and the summary never implies active probing.
- **Observations approaching the 30-day retention purge** — the recent window simply reflects what remains; no special handling beyond the rolling-window definition.
- **Many checks on one Component** — summary data arrives in the same bounded read regardless of check count; rendering does not paginate away or omit rows' summaries.

## Requirements _(mandatory)_

### Functional Requirements

**Compact summary**

- **FR-001**: Each check row in the Component checks table MUST display a compact availability figure for the rolling 24-hour window, computed with the same success/scheduled formula as the per-check detail metrics — scheduled-but-missed probes count as unsuccessful.
- **FR-002**: Each check row MUST display the p95 request-to-response-headers latency for the same 24-hour window — the same measurement boundary and percentile definition as the per-check detail metrics; the latency figure MUST show an explicit no-data state when the window holds no successful timed responses.
- **FR-003**: The summary display MUST label the window it covers and convey the execution vantage in "reachable from" phrasing consistent with the rest of the card — never implying global availability.
- **FR-004**: Figures in the compact summary MUST be consistent with the same check's detailed metrics for the same window — the compact display is a view onto the same metric definitions, not a separate formula.
- **FR-005**: A check with no observations in the window MUST show an explicit no-data presentation for its summary figures — never a fabricated 0% or 100% and never a stale figure carried over from before the window.
- **FR-006**: Scheduled-but-missed probes (coverage gap) MUST remain distinguishable from endpoint failures in the compact summary presentation, consistent with the coverage-gap semantics already shown on the detail page.

**Bounded read path**

- **FR-007**: The data required to render every row's recent-outcome strip and windowed summary MUST be delivered through a bounded read path whose request count is constant regardless of the number of checks; the table MUST NOT issue a per-check observations or metrics request.
- **FR-008**: The existing recent-outcome strip MUST be retained in the table and fed from the same bounded payload — its look and meaning are unchanged; only its data source changes.
- **FR-009**: The bounded read MUST remain side-effect-free on domain state and available to every role that can already view the Component's checks; no new permission or role gate is introduced.
- **FR-010**: The backend read that serves the table MUST keep a bounded query shape — the number of database queries it performs MUST NOT grow linearly with the number of checks on the Component.
- **FR-011**: Any API surface added or changed to carry the summary MUST be documented in the OpenAPI source in the same change, with generated endpoint tables regenerated per convention.

**Boundaries**

- **FR-012**: Metric definitions are unchanged: availability, error rate, coverage gap, and latency percentiles keep the formulas ratified for feature 051/ADR-124; this feature changes where they are displayed, not how they are computed.
- **FR-013**: The per-check detail page, observation history, and 24h/7d/30d metrics endpoints MUST continue to work unchanged — the compact summary is additive, not a replacement.
- **FR-014**: Monitoring data MUST NOT write to `ComponentInstance.status`, `Component.lifecycle`, importer runs, or product health, and check status MUST remain visually distinct from importer-reported instance status in the table.

### Key Entities _(include if feature involves data)_

- **URL Check**: existing entity — the row unit of the table; unchanged.
- **URL Check Observation**: existing entity — the source data for every summary figure and outcome dot; unchanged, including its 30-day retention.
- **Component Monitoring Setup**: existing entity — supplies the cadence and execution vantage the summary labels must reflect; unchanged.
- **Compact check summary** (derived, not persisted): per check, the recent-window availability figure, latency figure, coverage-gap share, and the recent outcome sequence — computed at read time from observations, never stored as a separate record.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: An operator can read the recent-window availability and latency of every check on a Component without opening any check detail page — 100% of populated rows show both figures.
- **SC-002**: Loading the checks table for a Component with 20 checks issues no more monitoring-data requests than loading one with a single check — zero per-check requests.
- **SC-003**: For every check, the table's availability and latency figures match the same check's detail-page values for the same window (within normal rounding for display).
- **SC-004**: In a window containing missed scheduled probes, the compact presentation keeps coverage gaps visibly distinguishable from endpoint failures — verified in tests for all-missed, partial-missed, and no-missed windows.
- **SC-005**: A Component with 50 checks renders the complete table with every row's summary present, with no fan-out and no truncated summaries.

## Assumptions

- The compact window is the **rolling 24-hour window** and the compact latency figure is **p95** — both ratified in the 2026-11-02 clarification session; the full p50/p95/p99 set across 24h/7d/30d stays on the detail page.
- The summary rides on the existing Component checks read path (list response or a bounded equivalent chosen at plan time); the contract shape is an implementation decision — the constant-request bound is the contract.
- The recent-outcome strip stays at its current depth (~12 latest observations) and is carried in the same bounded payload.
- No schema changes are expected: all figures derive from existing observations at read time.
- Out of scope: alerting, notification, trend charts beyond the existing outcome dots, user-selectable windows on the table, multi-vantage aggregation, the G3 onboarding gaps, and any change to the 30-day retention or success-policy model.
