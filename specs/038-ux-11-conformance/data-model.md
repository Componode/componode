# Data Model — 038 UX Conformance

No schema or API-contract changes. The entities this feature introduces
are bookkeeping records.

## GapRegistryEntry (researches/ux-rewrite-gaps.md)

Markdown section per gap, keyed `G{n}` (next free: **G21–G32**):

| Field | Content |
|---|---|
| Title | `## G{n} — <short name> — OPEN \| SPEC QUEUED \| RESOLVED` |
| Flagged surface | Route/component + flag name |
| Missing capability | The endpoint/field/behavior the UX needs |
| Resolution plan | Spec number in the v1.1.x queue, or DEFERRED + rationale |

New entries:

| Gap | Surface → missing capability | Queue |
|---|---|---|
| G21 | Component/importer list enrichment — `instances`+`lastSeenAt` on list, importer `lastRun` join (if not wired from `lastRuns`) | List-enrichment spec |
| G22 | Team member counts on teams list | List-enrichment spec |
| G23 | Stat-grid `+N this week` deltas | Dashboard-intelligence spec |
| G24 | Attention `detail` sub-lines + `CREDENTIAL_EXPIRING` kind | Dashboard-intelligence spec |
| G25 | Agent `createdBy`/`enrolledBy` | Dashboard-intelligence spec (audit/actor surface) |
| G26 | `includeGone` on component detail endpoint | DEFERRED after enrichment specs |
| G27 | Auth hardening — allowed email domains, password policy rows, email-on-register field | DEFERRED (security batch) |
| G28 | LOB owner field | DEFERRED (org-entity batch) |
| G29 | Manual component/group creation ("Add manually"/"New group") | Own spec — real authoring feature |
| G30 | "Keep me signed in" session-duration option | DEFERRED |
| G31 | Edge-authoring UI (`useAddEdge`/`useRemoveEdge` call sites) | Own spec |
| G32 | Suggestions decided-history view (ACCEPTED/DISMISSED/SUPERSEDED) | Own spec — ADR-113 observability |

## flags.ts

- **Add** one key per flaggable surface above (naming convention: camelCase
  of the surface, e.g. `componentListHealth`, `teamMemberCounts`,
  `statDeltas`, `attentionDetail`, `credentialExpiring`, `agentEnrolledBy`,
  `detailGoneInstances`, `manualEntityCreate`, `suggestionsHistory`) — all
  `false` except where the capability already exists.
- **Remove**: `profileSelfEdit` (resolved, zero consumers).
- Invariant enforced by SC-006: every key consumed; every consumption has
  a registry entry.

## View-type additions (ux/lib/view-types.ts)

Only where mappers gain fields the view already knows how to render:
`ImporterConfig.lastRun` (status/processed/completedAt) sourced from
`DashboardSummary.lastRuns`; attention `detail` stays null behind
`flags.attentionDetail` until G24 lands.
