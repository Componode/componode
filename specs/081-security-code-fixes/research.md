# Research: Code-Scanning Code Fixes

All decisions below were resolved during alert triage; no NEEDS CLARIFICATION
items remained in Technical Context.

## D1 — Canonical home for slugify

- **Decision**: `packages/core/src/utils/slug.ts`, re-exported from
  `@componode/core` root (matching `source-identity.ts`, `purl.ts`, …).
- **Rationale**: Core is the only package every consumer (backend, all 10
  importers) may depend on. Importers already import runtime helpers
  (`validateDiscoveredAsset`, `canonicalizeSourceIdentity`) from core, so no
  new dependency edge is created. ADR-065 stays intact.
- **Alternatives**: keep per-package copies rewritten safely (rejected — the
  duplication is itself the defect; the next rule change would diverge again);
  put it in backend and have importers import backend (forbidden by ADR-065 /
  constitution II).

## D2 — Algorithm that removes the flagged pattern

- **Decision**:
  1. `input.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-")` — the collapse
     regex stays (linear; was not the flagged sub-expression).
  2. Edge-trim via index checks (`startsWith("-")`/`endsWith("-")` + `slice`)
     instead of `/^-+|-+$/` — correct because the collapse step guarantees `-`
     runs are length ≤ 1, and O(n) with zero backtracking even if that
     invariant ever broke.
  3. Optional `maxLength`: `slice(0, maxLength)` then strip a trailing `-`
     left dangling by the cut.
- **Rationale**: byte-identical to the replaced implementations for all inputs
  the corpus covers, including the old `.replace(/-{2,}/g, "-")` in
  `utils/slug.ts` which was dead code (runs can't exist after the collapse).
- **Documented exception**: `toSlug` in product/org services could leave a
  trailing `-` when `slice(0, 100)` cut immediately after a separator. The
  canonical cap strips it. This can only differ on inputs whose slug exceeds
  the cap at exactly a separator boundary — never observed, and stripping is
  strictly a normalization improvement; uniqueness is unaffected.
- **Alternatives**: `/-/g` character-wise mapping (rejected — changes output,
  `a!!b` → `a--b`); keep `/-+$/` anchored regex (rejected — still the flagged
  pattern class).

## D3 — `user-service.ts` username slugify is excluded

- **Decision**: do NOT migrate `user-service.ts:26`.
- **Rationale**: its semantics differ deliberately —
  `username.toLowerCase().replace(/[^a-z0-9_-]/g, "-")` preserves `_`, maps
  character-wise (no collapsing), and performs no edge trim. Migrating would
  change stored `Person.slug` semantics. A comment marks it as intentional.
- **Note**: it was not flagged by CodeQL (character-class replace without `+`
  on `-` has no backtracking path).

## D4 — Regression corpus (identical-output requirement)

- **Decision**: a shared case table covering: typical names, all-dash /
  all-separator inputs, interleaved separators, leading/trailing whitespace
  and separators, unicode/non-Latin, empty string, 100-char boundary cases,
  and a 1M-char adversarial separator run (timing assertion).
- **Rationale**: corpus expectations are computed against the *old*
  implementations' semantics, which all collapse to the same effective
  function (verified by reading each copy); `maxLength` variants covered
  separately.

## D5 — OIDC issuer validation

- **Decision**: in `updateOidcConfig`, after stripping trailing slashes
  (existing behavior), parse with `new URL()` and require:
  - `protocol === "https:"`, OR `protocol === "http:"` **and** hostname ∈
    `{localhost, 127.0.0.1, [::1]}` (development IdPs on loopback);
  - `username === ""` and `password === ""` (no embedded credentials);
  - `search === ""` and `hash === ""`.
  Rejections throw the existing `OIDC_DISCOVERY_FAILED` (422) before any fetch.
- **Rationale**: `z.string().url()` at the route boundary accepts `ftp:`,
  `file:`, `http://10.x`, `https://user:pw@host` — all valid SSRF primitives.
  HTTPS-by-default matches the OIDC spec's TLS requirement; loopback HTTP is a
  legitimate deployment shape (local Keycloak) for a self-hosted tool, so a
  blanket private-IP block would break real use.
- **Alternatives**: allowlist hosts (impossible — arbitrary IdPs are the
  feature); block RFC1918/link-local (rejected — self-hosted deployments use
  internal IdPs); DNS-resolution pinning (over-engineering for an admin-gated
  endpoint; noted as residual risk for alert dismissal).

## D6 — Bounded discovery response

- **Decision**: keep `AbortSignal.timeout(5000)`; before JSON parsing, reject
  when `content-length` exceeds 64 KiB or the streamed body exceeds 64 KiB.
- **Rationale**: the current `response.json()` has no size bound; a hostile or
  misconfigured endpoint could return an arbitrarily large body. 64 KiB is
  far above any real `openid-configuration` document.
- **Error surface**: unchanged — failures map to `OIDC_DISCOVERY_FAILED` (422)
  with no stack/internal detail (ADR-096).

## D7 — Login-time discovery inherits the fix

- **Decision**: no separate change in `oidc-service.ts`.
- **Rationale**: `client.discovery(new URL(config.issuer), …)` fetches the
  *stored* issuer; the only write path is `updateOidcConfig`, which is where
  validation now gates. Persisted issuers are therefore always conformant.
  (Documented in contracts/oidc-issuer.md.)

## D8 — Frontend parity without a runtime core dependency

- **Decision**: `packages/frontend/src/ux/lib/slug.ts` keeps its own
  implementation, rewritten to the identical safe algorithm; the three
  component-level copies (`promote-form`, `product-form`, `org-form-dialog`)
  delegate to `deriveSlug`; `docker-setup-logic.ts` already wraps it.
- **Rationale**: ADR-065 scopes the frontend's core dependency to types; a
  runtime util import would cross that convention for a 6-line pure function.
  Parity is enforced by a shared case-table test on each side (the cases are
  duplicated by design — one source of truth per *layer*, per the docs rule).
- **Note**: `SLUG_RE` and `docker-setup-logic`'s `.slice(0, 200)` wrapper are
  unchanged.
