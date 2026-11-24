# Data Model: Code-Scanning Code Fixes

No schema, migration, or entity changes. This spec touches derivation logic
and input validation only.

## Entities touched (read/write behavior unchanged)

### Slug (derived value, no table)

- Present on `DigitalProduct`, `Component`, `ComponentInstance`,
  `ComponentGroup`, `Person`, `Team`, `LineOfBusiness`, and `Credential`
  (unique per entity type — ADR-046).
- Generated exclusively at create/derive time from caller-supplied names or
  importer-supplied names. **Stored values are never recomputed** — the
  consolidation changes only how *new* slugs are derived.
- Post-change output is identical to pre-change output for every input
  (FR-002) except a dangling `-` after max-length truncation, which is now
  stripped (research D2).

### OIDC Configuration (`oidc_config`, single row)

- `issuer: string | null` — now constrained at write time to a well-formed
  `https:` URL (or `http:` loopback) without userinfo/query/fragment. No
  column or stored-shape change; existing rows are unaffected.
- Read path (`oidc-service.ts` → `client.discovery`) is unchanged and
  consumes only validated values (research D7).
