# Research: Frontend UX Rewrite — Port Mechanics & Staging

Phase 0 output. Every NEEDS CLARIFICATION from Technical Context resolved
below. Ratified anchors cited inline; nothing here extends a contract
surface an ADR presents as closed.

## Decision: Stage under a `/ux/*` route prefix with code in `src/ux/`

**Rationale**: Both UIs run simultaneously at distinct URLs (FR-001) with zero
per-route flag plumbing; old UI stays default at `/`; deep links, manual QA,
and side-by-side screenshots are trivial; cutover is a mechanical mount move
(`/ux` → `/`) plus old-tree deletion (per clarification: no runtime fallback
ships in 1.1.0).

**Alternatives considered**: (a) Global boolean flag swapping elements
per-route — rejected: flag plumbing in every route, mixed visual states,
harder to diff. (b) Parallel path param/env build-time switch — rejected:
requires redeploy to opt in (violates SC-006). (c) Session/query flag serving
either tree at the same URL — rejected: ambiguous deep links during testing
and confusing bug reports.

## Decision: Mechanical import-mapping rules for the Next.js → Vite/Router port

| Prototype (Next.js) | Target (this repo) |
|---|---|
| `"use client"` directive | Deleted (all client in Vite) |
| `next/link` `<Link>` | `react-router-dom` `<Link>` |
| `next/navigation` `useRouter`/`usePathname`/`useSearchParams` | `useNavigate`/`useLocation`/`useSearchParams` |
| `app/…/page.tsx` | `src/ux/app/**` element wired in `routes.tsx` |
| `loading.tsx` / `error.tsx` / `not-found.tsx` | Per-route state components (prototype's states + added loading/error) |
| `app/(app)/layout.tsx` | `src/ux/ux-shell.tsx` route layout element |
| `next/image` | Plain `<img>` (no optimizer dependency) |
| Server components / server actions | Removed — data always via TanStack Query hooks |
| `notFound()` | Mapped to the shared not-found state |

**Rationale**: The prototype's component layer (Tailwind 4, radix, sonner,
recharts, cmdk, next-themes, lucide) is already the frontend's stack; only
routing/data plumbing differs, so a rule table keeps ports mechanical and
reviewable.

## Decision: Dependency mapping — reuse existing packages, drop prototype-only ones

- `radix-ui` (unified) → existing individual `@radix-ui/*` packages; add a
  missing one only if a ported component needs it (`pnpm add` in
  `packages/frontend`, `^` range, ≥7-day-old release).
- `@vercel/analytics` → dropped (self-hosted product; no Vercel analytics).
- `input-otp`, `cn`, `shadcn` runtime → evaluate per usage; prefer existing
  `lib/utils` `cn()` if present.
- `tw-animate-css` vs existing `tailwindcss-animate` → pick one at port time;
  prefer whichever the prototype's animations actually use.
- `next-themes` → already a dependency; reuse.
- Ratified in: AGENTS.md dependency rules (`^` ranges, lockfile committed,
  `pnpm lint && typecheck && test && build` before PR).

## Decision: One mapper per entity in `src/api/mappers/`

**Rationale**: FR-006 — API→view mapping happens in dedicated, unit-tested
functions (`mapProduct`, `mapComponent`, …), never inside components. Mappers
own: field renames (`at` ↔ `createdAt`), nullability fallbacks, enum narrowing
with neutral-badge fallback, slug→id resolution inputs, and derived values
(`durationSec`, `scheduleLabel`, `componentCount`).

**Alternatives considered**: mapping inside hooks — rejected, hides the
transform where tests can't see it cleanly.

## Decision: Feature-flagged gaps via a single flag registry + `researches/ux-rewrite-gaps.md`

- `src/ux/lib/flags.ts` exports named flags (`GAPS.historyAggregates`,
  `sessionDevice`, …) all defaulting to off; flagged elements render nothing.
- Every flag **must** have a matching entry in `researches/ux-rewrite-gaps.md`
  (what the UX needs, missing endpoint/data, affected routes) — the file is
  the authoritative input for the post-UX 1.1.0 gap specs (FR-016/FR-016a).
- Seeded from the prototype's documented gap list (6 items) + team/LOB detail.

**Alternatives considered**: env-var flags — rejected, requires rebuild to
flip and hides the inventory; runtime config — overkill for compile-time-dead
features.

## Decision: `useValidatedTab` hook for `?tab=`

Shared hook wraps `useSearchParams`: validates against a route's tab list,
falls back to `tabs[0]` on unknown/missing, writes back via `setSearchParams`
so tabs stay deep-linkable (FR-004). One implementation, unit-tested, reused
by every tabbed detail page.

## Decision: Prototype pinned at `v0-componode-dpam@9b040bc`

Reference SHA recorded here and in `spec.md` Assumptions. If v0 iterates
mid-flight, diffs are pulled by re-syncing the clone and re-diffing; the
wiring matrix in `contracts/wiring.md` is refreshed then, not per-route.

## Decision: Fixed-path exceptions

- `/auth/oidc/callback` — the backend redirects to this exact path; the new
  screen replaces the existing page component in place (not under `/ux`), or
  the old path renders the new component. Resolved at task time; the URL is a
  contract, the component isn't.
- `/login` — same treatment: new login screen may replace the old component
  in place if the staged shell needs it before cutover.

## Decision: Test strategy per route (Principle VI)

Per route, before the port: (a) mapper unit tests (null fallbacks, enum
narrowing, derived fields); (b) a state-matrix smoke test where cheap
(loading/empty/error/not-found via mocked query states). Then port, then
`pnpm test` + `typecheck`. E2E remains deferred (ADR-029).

## Decision: `/standards` and `/standards/wiring` ship as the living baseline

They document the ported design system and the wiring contract — part of the
FR-020 baseline deliverable. Shown in the new UX nav as internal/reference
surfaces; no auth change (same `authed` wrapper).

## Open items deliberately left to implementation

- Exact `flags.ts` flag names (created per gap as encountered).
- Whether `tw-animate-css` or `tailwindcss-animate` survives the port.
- `/login` handling (above).
