# Feature Specification: Code-Scanning Code Fixes (Slugify Consolidation + OIDC Issuer Hardening)

**Feature Branch**: `081-security-code-fixes`

**Created**: 2026-11-23

**Status**: Draft

**Input**: User description: "Remediate the GitHub code-scanning alerts that require application-code changes: nine CodeQL `js/polynomial-redos` findings on duplicated slug-generation regex chains (backend `utils/slug.ts`, `services/product-service.ts`, `services/org-service.ts`, `services/credential-service.ts`, and importers aws/azure/kubernetes/mcp-server — plus unflagged copies in importer-github, importer-alibaba-cloud, and the frontend), and the critical CodeQL `js/request-forgery` finding on the OIDC discovery fetch in `updateOidcConfig` (`packages/backend/src/services/settings-service.ts`)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Slug generation is safe, single-sourced, and unchanged in behavior (Priority: P1)

Every entity name a user types — a product name, team name, credential label,
or an imported component name — is converted to a URL-safe slug. Today the same
normalization routine is copy-pasted across the backend, six importer packages,
and the frontend, and static analysis flags it as a potential
regular-expression denial-of-service pattern. The user needs one canonical
slug-generation routine whose observable output is identical to today's for
every existing input, that no longer matches the flagged pattern, and that is
used everywhere the duplicates lived.

**Why this priority**: A ReDoS flag on uncontrolled input is a correctness and
supply-chain-trust issue; ten divergent copies also means any future slug rule
change (max length, allowed characters) silently diverges. Consolidation is
the only fix that both closes the alert and removes the duplication defect.

**Independent Test**: A shared test corpus of edge-case inputs (all-dashes,
interleaved dashes, unicode, whitespace, very long names, empty strings) is run
through the canonical routine and produces byte-identical output to the
previous implementations; every former call site delegates to it.

**Acceptance Scenarios**:

1. **Given** an input containing a run of hundreds of `-` or other
   non-alphanumeric characters, **When** a slug is generated, **Then** the
   routine completes in linear time with no backtracking blow-up and returns a
   normalized slug.
2. **Given** any input accepted before the change, **When** the canonical
   routine runs, **Then** the produced slug is identical to what the replaced
   implementations produced (no existing stored slugs change).
3. **Given** any importer or backend service that previously kept its own copy
   of the routine, **When** its code is inspected, **Then** it delegates to the
   single shared routine and contains no local regex copy.
4. **Given** the code-scanning analysis is re-run, **When** it evaluates the
   slug-generation code, **Then** the polynomial-regex pattern is absent.

---

### User Story 2 - OIDC issuer discovery fetch cannot be abused as an arbitrary network probe (Priority: P1)

An administrator configures OIDC by providing an issuer URL; the server
performs a discovery fetch against that issuer before persisting the
configuration. Today the only validation is "parses as a URL", so the issuer
can carry any scheme (including non-HTTP(S)), embedded userinfo credentials,
or an arbitrary host/port, and the server will fetch it and return
distinguishable errors — a textbook server-side request forgery primitive
(authenticated, but still a network probe into the deployment's internal
network). The user needs the issuer validated and the fetch bounded so that
only legitimate discovery endpoints are contacted.

**Why this priority**: This is the single "critical"-severity finding on the
repository. Even though the route is admin-gated, a self-hosted product must
not ship an endpoint that fetches arbitrary attacker-chosen URLs.

**Independent Test**: Submitting issuers with non-HTTPS schemes (except
loopback HTTP for development identity providers), embedded credentials, or
malformed URLs is rejected with a validation error before any network request
is made; a well-formed HTTPS issuer still passes discovery as before.

**Acceptance Scenarios**:

1. **Given** an issuer string with a non-HTTP(S) scheme (e.g. `file:`,
   `ftp:`, `gopher:`), **When** the configuration is submitted, **Then** it is
   rejected with a validation error and no outbound request occurs.
2. **Given** an `http:` issuer pointing at a non-loopback host, **When** the
   configuration is submitted, **Then** it is rejected with a validation
   error and no outbound request occurs.
3. **Given** an `http:` issuer pointing at a loopback host (`localhost`,
   `127.0.0.1`, `[::1]`), **When** the configuration is submitted, **Then**
   discovery proceeds — development IdPs such as local Keycloak must keep
   working.
4. **Given** an issuer containing userinfo (`https://user:pass@host`), a
   fragment, or query parameters, **When** the configuration is submitted,
   **Then** it is rejected with a validation error and no outbound request
   occurs.
5. **Given** a valid `https:` issuer, **When** discovery runs, **Then** the
   request completes under the existing timeout, the response body is
   size-bounded, and behavior is otherwise unchanged.
6. **Given** discovery to a valid issuer fails (timeout, non-200, invalid
   document), **When** the error is returned, **Then** it carries the same
   `OIDC_DISCOVERY_FAILED` error code and does not leak internal detail.

---

### Edge Cases

- **All-non-alphanumeric names** (`"!!!"`, `"---"`): the canonical slug
  routine still returns the per-caller fallback (`"unknown"`,
  `"credential"`, etc.) — fallback strings remain caller-owned.
- **Length truncation**: callers that capped slugs at 100 characters keep the
  cap, and truncation does not leave a trailing separator.
- **Unicode / non-Latin input**: characters outside `a-z0-9` collapse to the
  separator exactly as before.
- **Issuer with trailing slash(es)**: normalized before validation and before
  the discovery fetch, exactly as today.
- **Issuer redirecting to another host**: discovery follows no manual
  redirect handling change; documented as acceptable.
- **Empty or whitespace-only name**: produces the caller fallback, unchanged.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a single canonical slug-normalization
  routine, owned by the shared contracts layer, available to the backend and
  to every importer package without violating the package dependency rules
  (importers depend only on `core`; backend may depend on `core`).
- **FR-002**: The canonical routine MUST produce output identical to the
  replaced implementations for every input: lowercase, trim, collapse runs of
  non-`a-z0-9` characters into single `-` separators, strip leading/trailing
  separators, and support an optional maximum-length cap.
- **FR-003**: The canonical routine MUST run in linear time on adversarial
  input (long separator runs) and MUST NOT use a regular-expression pattern
  flagged as polynomial backtracking on repetitions of `-`.
- **FR-004**: All previously duplicated slug routines — in backend services,
  the backend slug utility, and the affected importer packages (aws, azure,
  kubernetes, mcp-server, github, alibaba-cloud) — MUST be replaced by calls
  to the canonical routine, preserving each caller's existing fallback
  behavior and length caps.
- **FR-005**: Frontend slug preview logic MUST remain output-identical to the
  backend canonical routine for the same input.
- **FR-006**: The OIDC issuer value MUST be rejected before any network
  access when it is not a syntactically valid URL, uses a scheme other than
  `https:` (except `http:` on loopback hostnames), or contains userinfo,
  query, or fragment components.
- **FR-007**: The OIDC discovery request MUST remain time-bounded (existing
  5-second timeout or shorter) and its response body MUST be size-bounded
  before JSON parsing.
- **FR-008**: Validation failures of the issuer MUST surface as the existing
  `OIDC_DISCOVERY_FAILED` / validation error codes without leaking stack
  traces, resolved IPs, or internal network detail (ADR-096).
- **FR-009**: Existing stored OIDC configurations and the public
  `PUT /settings/oidc` contract MUST remain unchanged apart from the added
  issuer validation — no endpoint, field, or permission changes (ADR-104:
  `docs/openapi.yaml` must reflect any description change).
- **FR-010**: No `sql.raw()`/`sql.fragment()`, `dangerouslySetInnerHTML`, or
  secret material may be introduced by the change (ADR-084/085/090).

### Key Entities *(include if feature involves data)*

- **Slug**: Derived, human-readable identifier for `DigitalProduct`,
  `Component`, `ComponentInstance`, `ComponentGroup`, `Person`, `Team`,
  `LineOfBusiness`, and credentials. Unique per entity type (ADR-046).
  Behavior must be identical pre- and post-change so no stored slug or
  external reference breaks.
- **OIDC Configuration**: Single-row deployment config (`oidc_config`) whose
  `issuer` field drives the discovery fetch. One IdP per deployment
  (constitution I).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Re-running the code-scanning analysis shows zero
  polynomial-regex findings on slug-generation code paths (9 findings
  closed).
- **SC-002**: The canonical slug routine processes a 1,000,000-character
  adversarial input (repeated separators) in well under one second.
- **SC-003**: 100% of prior slug outputs in the regression corpus are
  reproduced identically by the canonical routine.
- **SC-004**: Non-conforming OIDC issuers are rejected client-verifiably
  (error code returned, no outbound fetch attempted) in 100% of the defined
  rejection cases; valid HTTPS issuers still complete discovery.
- **SC-005**: All existing unit, integration, and Playwright coverage passes
  unchanged after the migration — no behavioral regression.

## Assumptions

- The code-scanning alerts were triaged: the slug regexes are not exploitable
  in practice (the collapse step bounds separator runs to length 1), but the
  flagged pattern must still be removed; the SSRF finding is a genuine
  hardening requirement even though the route is admin-only.
- Loopback `http:` issuers are a legitimate development/deployment
  configuration (local Keycloak) and remain permitted; non-loopback plain
  HTTP is not.
- Repository-level Scorecard findings (branch protection, token pinning,
  LICENSE/SECURITY.md) are handled by the separate spec
  `082-supply-chain-hardening`; GitHub-side dismissals are a maintainer
  action outside code scope.
- Frontend slug code is browser-side preview only; it is aligned to the same
  routine logic but does not import backend code.
