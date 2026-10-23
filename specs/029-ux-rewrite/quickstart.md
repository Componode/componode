# Quickstart: Validating the UX Rewrite

## Prerequisites

- Componode dev environment running (backend + seeded data): `pnpm dev` or
  the Docker Compose stack per `docs/deployment.md`.
- The v0 prototype clone for side-by-side diffing:
  `git clone https://github.com/Componode/v0-componode-dpam` then
  `pnpm install && pnpm dev` inside it (Next.js on its own port).
- Sign-in credentials for the seeded deployment.

## What to check per completed route

For every route row in [contracts/wiring.md](contracts/wiring.md):

1. **Live data**: open the `/ux/…` page and the equivalent prototype page
   side by side — same layout and copy, real data (no fixture values like
   seeded mock names).
2. **States**: loading (throttle network), empty (fresh tenant/filter),
   error (stop the API), not-found (bogus slug/id), forbidden (sign in as a
   non-admin for admin routes).
3. **Tabs**: `?tab=<garbage>` shows the first tab, not an error.
4. **Mutations**: each control calls the real API — watch the network tab —
   keeps its success toast, and displays the API error on failure
   (e.g., self role change → 403 message; blocked delete → 409 reason).
5. **Secrets**: create/rotate a credential or agent token — only masked
   hints render; the token appears once, in the issuing dialog.
6. **Deep links**: copy a `?tab=` URL into a fresh tab — lands on that tab.

## Automated checks

```bash
pnpm --filter @componode/frontend typecheck
pnpm --filter @componode/frontend test     # mapper unit tests + state smokes
pnpm lint && pnpm build                    # workspace-wide, before the PR
```

## Cutover validation (final phase)

1. `/` serves the new shell; `/ux` redirects (or is removed per cutover plan).
2. Old `src/pages/` and retired components are deleted; no dead imports.
3. `researches/ux-rewrite-gaps.md` lists every flagged element, and every
   flag in `src/ux/lib/flags.ts` has a matching entry there.
4. `docs/ux.md` reflects the new baseline; `docs/roadmap.md` marks the gap
   specs as the next 1.1.0 step.

## Expected outcome

A user can browse the catalog, author products, operate importers/agents,
and administer the org entirely within the new UX — the old UI is gone, and
every backend gap is documented for its follow-on spec.
