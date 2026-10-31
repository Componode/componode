# Contract — Importer context and manifest deltas

`packages/core/src/contracts/importer.ts`,
`packages/core/src/importer-registry.ts`. Ratified base: ADR-056
Amendment 1; additions here ratified via ADR-056 Amendment 2.

## `ImporterContext` — gains two required members

```ts
interface SourceIdentityInput {
  /** provider-native canonical, non-secret identity */
  externalIdentity: string;
  /** optional display label — never used for matching */
  label?: string;
}

interface ImporterContext {
  runId: string;
  logger: Logger;
  signal: AbortSignal;
  reportPhase: (name: string) => Promise<void> | void;
  tracer?: Tracer;
  /** Registers/matches the run's ImporterSource. MUST be called before the
   *  first asset yield — including empty inventories — when the manifest
   *  declares reportsSourceIdentity. */
  reportSourceIdentity: (identity: SourceIdentityInput) => void | Promise<void>;
  /** Returns the preflight-resolved target profile. Valid only when the
   *  manifest declares targetRefKey; throws otherwise. In-process runs get
   *  a stub that throws — target profiles resolve only on Import Agents. */
  resolveTarget: (targetId: string) => unknown;
}
```

- The executor (hub `worker` or agent `JobExecutor`) owns the
  implementation; importers stay pull-only, never touch the DB
  (constitution II).
- URL `externalIdentity` values are canonicalized executor-side before
  persistence (strip userinfo, auth query params, fragment) — a core util
  `canonicalizeSourceIdentity(identity)`.
- Contract violation: manifest `reportsSourceIdentity === true` + first
  yield (or generator completion) without a report → run `FAILED` with
  `errorType = "CONTRACT_VIOLATION"`.
- Both context construction sites get the members:
  `import-run-service.ts` worker and `packages/agent/src/executor.ts`.
  Test `makeContext` helpers are updated to the new required shape.

## `ImporterManifest` — gains two optional fields

```ts
interface ImporterManifest {
  /* …existing… */
  /** Names the config-scope key carrying the agent-local targetId.
   *  Presence means: remote execution + agent registry preflight. */
  targetRefKey?: string;
  /** Declares this importer calls reportSourceIdentity before first yield.
   *  Absent/false = legacy unattributed path (until its Wave-B migration). */
  reportsSourceIdentity?: boolean;
}
```

## `ImportRun` contract — nullable attribution

```ts
interface ImportRun {
  /* …existing… */
  configId: string | null;   // was string — config may be deleted post-run
  sourceId: string | null;   // new — null = LEGACY_UNATTRIBUTED
}
```

Read DTOs may additionally expose `sourceExternalIdentity` /
`sourceLabel` (left-join render fields) and `configLabel` stays
left-join tolerant.
