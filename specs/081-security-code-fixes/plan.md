# Implementation Plan: Code-Scanning Code Fixes (Slugify Consolidation + OIDC Issuer Hardening)

**Branch**: `081-security-code-fixes` | **Date**: 2026-11-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/081-security-code-fixes/spec.md`

## Summary

Remediate the two classes of open CodeQL alerts that require application-code
changes. (1) Consolidate ~10 duplicated slug-normalization regex chains into a
single `slugify()` in `packages/core`, reimplemented without the
polynomial-backtracking pattern (`/^-+|-+$/`), and migrate every backend,
importer, and frontend call site while preserving byte-identical output.
(2) Harden the OIDC discovery fetch in `updateOidcConfig`: strict `new URL()`
validation (https-only except loopback http, no userinfo/query/fragment) before
any network access, plus a size-bounded response body.

## Technical Context

**Language/Version**: TypeScript 6, Node 24 (`.nvmrc`, `node:24-alpine` images)

**Primary Dependencies**: `packages/core` (leaf shared contracts — owns the
canonical routine); Fastify + Kysely backend; `openid-client` for login-time
discovery; no new dependencies.

**Storage**: N/A — no schema or migration changes; slugs are generated at
write time, never recomputed for stored rows.

**Testing**: Vitest unit tests (`packages/core/test/`, `packages/backend/test/unit/`),
testcontainers integration tests, Playwright e2e (`playwright/tests/`).

**Target Platform**: Linux container (Alpine) backend; browser frontend.

**Project Type**: pnpm monorepo (core → backend + importers + frontend).

**Performance Goals**: `slugify` linear-time on ≥1M-char adversarial input
(SC-002); OIDC discovery unchanged latency bound (5 s timeout).

**Constraints**: Zero `@componode/*` deps added to `core` (leaf rule);
importers depend only on `core` (ADR-065); frontend mirrors algorithm
(ADR-065 types-only core dependency); output must be identical to replaced
implementations (FR-002) with one documented exception (trailing separator
after max-length truncation, see research D2).

**Scale/Scope**: ~10 slug call sites (4 backend + 6 importer locations +
4 frontend locations); 1 fetch site + 1 schema/service boundary for OIDC.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Single-Org** — PASS: no tenant surface touched.
- **II. Importer-First** — PASS: canonical routine lands in `packages/core`;
  importers stay core-only dependents; no DB access added.
- **III. Two-Level Taxonomy** — PASS: not touched.
- **IV. Environment-as-Instance** — PASS: not touched.
- **V. Factual vs. Meaning** — PASS: not touched.
- **VI. Test-First** — PASS: tasks order test authoring before implementation;
  corpus-parity unit test is the failing-first artifact; Playwright coverage
  ships for the OIDC settings surface.
- **VII. Observability** — PASS: no new runtime path that needs instrumentation
  (discovery fetch already logs via Fastify request context; issuer rejection
  is a routine validation error).

**Post-design re-check**: PASS — no violations; no Complexity Tracking rows.

## Project Structure

### Documentation (this feature)

```text
specs/081-security-code-fixes/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions D1–D8
├── data-model.md        # Phase 1 — entities touched (no schema change)
├── contracts/
│   ├── slug.md          # slugify() contract + edge-case table
│   └── oidc-issuer.md   # issuer accept/reject matrix
├── quickstart.md        # validation guide
├── checklists/
│   └── requirements.md  # spec quality checklist
└── tasks.md             # /speckit-tasks output
```

### Source Code (repository root)

```text
packages/core/src/utils/slug.ts              # NEW — canonical slugify()
packages/core/src/index.ts                    # export the new util
packages/core/test/slug.test.ts               # NEW — corpus + adversarial tests

packages/backend/src/utils/slug.ts            # delegates to core; keeps
                                              # generateUniqueSlug /
                                              # generateComponentSlug /
                                              # generateInstanceSlug wrappers
packages/backend/src/services/
├── product-service.ts                        # toSlug → core slugify(…,100)
├── org-service.ts                            # toSlug → core slugify(…,100)
├── credential-service.ts                     # deriveCredentialSlug → core
├── settings-service.ts                       # OIDC issuer validation +
│                                             # bounded discovery fetch
└── user-service.ts                           # EXCLUDED — different semantics
                                              # (allows '_', charwise); comment

packages/importer-{aws,azure,kubernetes,mcp-server}/src/importer.ts
packages/importer-github/src/github-extras.ts # 2 inline chains → core
packages/importer-alibaba-cloud/src/mapping.ts# slugify/componentSlug → core

packages/frontend/src/ux/lib/slug.ts          # mirrored safe algorithm
packages/frontend/src/ux/components/
├── components/promote-form.tsx               # → ux/lib deriveSlug
├── products/product-form.tsx                 # → ux/lib deriveSlug
└── org/org-form-dialog.tsx                   # → ux/lib deriveSlug

playwright/tests/auth/oidc.spec.ts            # issuer-validation e2e case
```

**Structure Decision**: canonical routine in `packages/core/src/utils/`
alongside `source-identity.ts` etc.; backend keeps its thin wrappers in
`utils/slug.ts` so existing import sites are untouched.

## Complexity Tracking

> No constitution violations — section intentionally empty.
