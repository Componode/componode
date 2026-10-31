# Quickstart — validating 038 UX Conformance

## Prerequisites

- Repo on branch `038-ux-11-conformance`; `pnpm install` done.
- Seeded dev data (docker-compose hub + a seeded catalog, or the existing
  test fixtures) with: ≥1 component in ERROR/GONE, ≥1 failed run,
  ≥1 RETIRED component group, an agent session with `replaced` reason,
  a LOB owning teams.

## Automated

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

Every defect fix ships a regression test — the suite is the primary gate.

## Manual spot-walk (acceptance scenarios)

1. **Dashboard** → attention row for a component → lands on component
   detail (not "Component not found"). Stat deltas hidden (flag off).
2. **Users** → row menu → "Send password reset" → token toast (once).
3. **Agents → detail → sessions** → a `replaced` row shows a labeled
   badge; header shows "Created {date}" (enrolled-by hidden, flag off).
4. **LOBs → detail (owns teams, zero products)** → delete blocked reason
   names the teams.
5. **Components** → opt-in toggle shows GONE-instance components;
   **Component groups** → opt-in shows RETIRED groups. Component detail
   card copy no longer claims "Gone instances are kept for 30 days"
   (accurate copy until G26 lands).
6. **Importers** → cards show real last-run status/time (from
   `lastRuns`); detail Executor row shows `agentIncompatible` degraded
   state; "convert secrets" control runs the hook.
7. **Products → detail → Map** → composes/consumes/depends-on relations
   labeled on the canvas; consumer criticality badges populated.
8. **Header** → breadcrumbs resolve entity names; no Help/Notifications
   icons; no unread dot.
9. **/register** → password checklist + "starts as Viewer" alert;
   **/auth/oidc/callback** → AuthShowcase shell; auth footer shows version.
10. **Credentials** → "Write-only by design" alert present.
11. **Settings → workspace** → default-role offers Viewer/Editor only;
    flagged sections show gap notices (not empty content).
12. **Settings → security** → sessions list shows device + location.
13. **?tab=bogus** on any tabbed detail → first tab renders.
14. Toggle the sidebar → reload in the same tab keeps state; a second
    tab does NOT inherit it (sessionStorage).

## Governance verification

```bash
# every flag consumed
grep -rn "flags\." packages/frontend/src | sort -u
# every flag has a registry entry
grep -n "G2[0-9]\|G3[0-9]" researches/ux-rewrite-gaps.md
```

- `docs/ux.md` §2/§8/§9 amended; new canvas ADR indexed in
  `researches/architecture-decisions.md`; ADR-103 back-pointer present.
