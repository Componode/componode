### ADR-090 — No secrets in logs

> **Status:** Ratified

**Context**: Pino is structured logging (JSON) — every field in the
metadata object is persisted. A `log.info({ secrets }, "importer starting")`
would write all resolved secrets to the log file in plaintext.

**Decision**: **Pino redaction filter strips prohibited field paths.**
Redacted paths: `password`, `passwordHash`, `clientSecret`, `secretRefs`,
`secrets`, `secrets.*`, `sessionToken`, `sessionId`, `authorization`,
`cookie`, `oidcSubject`, `email`, `importer_configs.secretRefs`,
`importer_configs.scope`. Replaced with `"[REDACTED]"`. Importers receive an
abstracted `Logger` ([ADR-067](./ADR-067-logger-abstraction.md)) pre-configured with the same redaction. When
logging an importer's configuration, log only safe metadata (`importerName`,
`configId`, `label`, `schedule`), never the full `importer_configs` row.
When logging a request, log headers selectively. Stack traces are logged
as-is (documented tradeoff — sanitizing is over-engineering for v1).

**Rationale**: Structured logging makes accidental secret leakage easy and
persistent. The redaction filter catches known field names. The
`importer_configs.scope` redaction catches the case where scope contains
account IDs or tokens. Stack trace sanitization is deferred (the risk of
embedded credentials in URLs is mitigated by `secrets.*` redaction).

---

**Amended by ADR-117**: the rule extends to the Import Agent process —
agent-side secret resolution logs key names and source types only, never
values; the agent applies `redactSecrets`-equivalent discipline to all
log emission.