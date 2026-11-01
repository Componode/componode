# Importer Development Guide

This document is the contributor contract for adding new importers to Componode. It applies to all packages under `packages/importer-*`.

---

## Core rules

1. **Importers are pull-only.** They read from an external system and yield `DiscoveredAsset` records. They never write to the Componode database, call backend services, or push data back to the source.
2. **Importers depend only on `@componode/core`.** They must not import from `@componode/backend` or from other importers.
3. **Secrets are resolved by the core.** The backend resolves the importer config's `credentialIds` (stored `Credential` bundles, AES-256-GCM encrypted — see ADR-107) and legacy `secretRefs` into a `Record<string, string>` and passes that map to the importer. Importers must not read `process.env`. Declare the keys your importer consumes in `manifest.secrets` — the backend validates coverage at config save time and fails the run before execution when a required key is missing, a credential is revoked, or keys collide across sources.
4. **Respect `AbortSignal`.** All long-running or paginated work must check `context.signal.aborted` and, where the underlying SDK supports it, pass the signal into network requests.
5. **Validate with `validateDiscoveredAsset`.** The backend validates each yielded asset, but importers should avoid emitting invalid data.
6. **Use structured logging.** Write progress through `context.logger` and `context.reportPhase`.
7. **No `relationships` in v1.** `DiscoveredAsset.relationships` is not part of the v1 contract.
8. **URL-fetching importers must use `urlSafetyError` from `@componode/core`.** Any importer config field that accepts a URL to fetch must validate it with the shared SSRF guard (applied via `.superRefine` on the Zod config schema, as `importer-web-url` and `importer-api-url` do). It rejects non-HTTP(S) schemes, `localhost`, `.local`, loopback/private/link-local/CGNAT IPv4, IPv6 loopback/ULA/link-local, and cloud-metadata addresses. The guard checks the URL _as written_ and cannot prevent DNS rebinding — a public hostname may resolve to a private address at request time — so deployments that expose importer configuration should additionally restrict container egress (see ADR-106).

---

## Package structure

Each importer package follows the same layout:

```text
packages/importer-<provider>/
├── package.json
├── tsconfig.json
├── src/
│   ├── config.ts       # Zod schema for the importer-specific scope
│   ├── manifest.ts     # ImporterManifest exported as `manifest`
│   └── importer.ts     # Importer.run implementation
└── test/
    └── importer.test.ts
```

### `package.json`

- `type: "module"`
- `exports` for `./manifest` and `./importer`
- `dependencies`: only `@componode/core` plus the SDK needed to talk to the source

### `manifest.ts`

```ts
import { githubConfigSchema } from "./config.js";

export const manifest = {
  name: "github",
  label: "GitHub",
  description: "Import GitHub repositories as components.",
  version: "1.0.0",
  implPath: "@componode/importer-<provider>/importer",
  configSchema: githubConfigSchema,
  // Secret keys this importer consumes — drives save-time coverage validation
  // and the credential picker's hints. Optional; defaults to [].
  secrets: [{ key: "token", label: "Personal access token", required: true }],
};
```

### `config.ts`

```ts
import { z } from "zod";

export const githubConfigSchema = z.object({
  org: z.string().min(1),
  repos: z.array(z.string()).optional(),
  includeForks: z.boolean().default(false),
  includeArchived: z.boolean().default(false),
});

export type GithubConfig = z.infer<typeof githubConfigSchema>;
```

### `importer.ts`

```ts
import type {
  DiscoveredAsset,
  Importer,
  ImporterContext,
} from "@componode/core";
import type { GithubConfig } from "./config.js";

export class GithubImporter implements Importer {
  readonly name = "github";
  readonly version = "1.0.0";

  async *run(
    config: Record<string, unknown>,
    secrets: Record<string, string>,
    context: ImporterContext,
  ): AsyncGenerator<DiscoveredAsset> {
    const parsed = config as GithubConfig;
    context.reportPhase("Authenticating");

    for await (const asset of fetchAssets(parsed, secrets, context)) {
      if (context.signal.aborted) return;
      yield asset;
    }

    context.reportPhase("Completed");
  }
}
```

---

## `DiscoveredAsset` contract

```ts
export interface DiscoveredAsset {
  category: ComponentCategory;
  provider: string;
  resourceType: string;
  name: string;
  externalId: string;
  slug?: string;
  details?: Record<string, unknown>;
  instances: DiscoveredAssetInstance[];
}

export interface DiscoveredAssetInstance {
  environment: string;
  externalId: string;
  url?: string | null;
  status?: string;
  version?: string | null;
  deployedAt?: string | null;
  rawConfig?: Record<string, unknown> | null;
}
```

- `category` must be one of the `COMPONENT_CATEGORIES` values in `packages/core`.
- `externalId` must be stable across runs for the same source asset — prefer the provider's immutable numeric ID over names that can change on rename/transfer.
- `instances` represents environment-specific deployments of the same logical component.

## Credential permissions

Document the minimum token/credential scopes your importer needs and which
sections degrade without them. For the GitHub importer: `read:org` is the
minimum for org profile, repos, and teams; billing, self-hosted runners, and
packages additionally require org-admin (`admin:org`) scope. Missing
permissions surface as `FORBIDDEN` capability markers (below), never as run
failures.

## Optional capabilities (best-effort sections)

Sections whose availability depends on the credential's permissions or the
provider version must degrade gracefully: wrap each optional call in a
capability guard (see `withCapability` in `packages/importer-github/src/capabilities.ts`),
record `{status: "OK"|"FORBIDDEN"|"UNAVAILABLE"|"ERROR", message?}` on the owning
component's `details.capabilities`, and continue the run. A 403 on a billing
endpoint must not fail the whole import. Fatal capabilities (e.g. the resource
listing itself) may still throw.

## Credential testing (`testSecrets`)

An importer may expose a cheap authentication probe so users can verify stored
credentials from the UI before running an import:

```ts
export class GithubImporter implements Importer {
  // ...run() as above...

  async testSecrets(
    secrets: Record<string, string>,
    config?: Record<string, unknown>,
  ): Promise<CredentialTestResult> {
    // Minimal authenticated request — never a full import.
    const octokit = new Octokit({ auth: secrets.token });
    await octokit.rest.rateLimit.get();
    return { ok: true };
  }
}
```

Rules:

- `testSecrets` is optional; importers without it return `MANIFEST_NO_TEST`
  from `POST /credentials/{id}/test`.
- Probe with the smallest authenticated call available (a rate-limit or
  identity endpoint). Never run a full import.
- Return `{ ok: false, error }` for upstream auth failures; error strings must
  never echo credential values.
- Tests must mock the SDK (`vi.mock("octokit")` for GitHub) — no live network.

---

## Adding a new importer

1. Copy `packages/importer-github` to `packages/importer-<provider>`.
2. Replace the SDK, config schema, and `run` implementation.
3. Add the package to `packages/backend/package.json` **and**
   `packages/agent/package.json` as a `workspace:*` dependency. Import Agents
   ship all in-tree importers and the hub/agent handshake enforces lockstep
   parity (ADR-116) — forgetting either manifest produces `importer_mismatch`
   at agent connect.
4. Register the package in `packages/core/src/importer-registry.ts`
   (`IMPORTER_PACKAGES` is shared by the hub and the agent — spec 025 moved
   the list into core):

   ```ts
   export const IMPORTER_PACKAGES = [
     "@componode/importer-github",
     "@componode/importer-<provider>",
   ] as const;
   ```

5. Run `pnpm install`, `pnpm -r build`, and `pnpm -r typecheck`.
6. Add unit tests for the new importer and an integration test through the backend run service.
7. Write the user-facing setup guide at `docs/importers/<name>.md` (required — see below) and add it to `docs/importers/index.md` and the VitePress sidebar in `docs-site/.vitepress/config.ts`.

## User documentation (required)

Every importer MUST ship a user guide at `docs/importers/<name>.md`, and
any importer change that alters what a user configures or provisions MUST
update it. The guide covers, at minimum:

- **What it imports** — the components/instances a run produces.
- **External-tool setup** — exactly what the user must do in the provider's
  console/API before the importer works: services to enable, accounts or
  roles to create, minimum permissions/scopes, and which optional sections
  degrade without them.
- **Credentials** — each `manifest.secrets` key, required vs optional, and
  where to obtain the value.
- **Configuration** — a table of every config field: type, default, effect.
- **Troubleshooting** — common failure modes (disabled service, missing
  permission, bad URL) and their fix.

---

## Testing checklist

- [ ] Unit tests mock the external SDK and verify yielded `DiscoveredAsset` records.
- [ ] Unit tests verify `AbortSignal` stops iteration cleanly.
- [ ] Integration test triggers a run through the backend and verifies DB rows.
- [ ] `pnpm build` and `pnpm typecheck` pass for the new package.

## Source identity and target references (spec 044, spec 045)

Importers that adopt durable provenance declare `reportsSourceIdentity: true`
on their manifest and call `context.reportSourceIdentity({externalIdentity,
label?})` before the first asset yield — including empty inventories.
`externalIdentity` is the provider-native canonical, non-secret identity
(URL identities are canonicalized executor-side). Missing the report on an
adopting importer fails the run `CONTRACT_VIOLATION`.

Per-importer identity keys (spec 045, ADR-120 — full table in
`specs/045-importer-source-migration/contracts/source-identity-keys.md`):

| Importer | Identity | Scope-less fallback |
|---|---|---|
| github | `{canonicalApiBaseUrl}org/{orgId}` | `{base}login/{org}` when org unreadable |
| alibaba-cloud | STS `GetCallerIdentity` accountId | — (run fails) |
| azure | `subscriptionId` | `scope.sourceKey` |
| aws | `scope.sourceKey` (required) | — (run fails) |
| kubernetes | canonical `endpoint` | `scope.sourceKey` |
| mcp-server | canonical `endpoint` | `scope.sourceKey` |
| api-url / web-url | canonical `url` | — (URL is required) |

Where the existing `externalId` is source-local or collision-prone, qualify
it with `qualifyExternalId(identity, id)` from `@componode/core` — the
backend's adopt-on-report pass matches a legacy unqualified component once,
then the qualified form is stable thereafter. GHES qualifies (numeric IDs
collide across instances); github.com, Alibaba ARN, and URL identities do
not need it. Importers may emit `sourceDetails` on assets/instances — those
persist on the Source membership (`source_component_memberships.details`),
while canonical `details` remain shared. Migration 023 backfills
Source+memberships only where identity is derivable from live config scope;
legacy `import_runs.sourceId` stays `NULL` (`LEGACY_UNATTRIBUTED`) and
`externalId` is never batch-rewritten.

Manifests declaring `targetRefKey` name the config-scope key carrying a
`targetId`; the Agent preflights it against
`${SECRETS_DIR}/{importerName}-targets.json` and the importer reads the
resolved non-secret profile via `context.resolveTarget(targetId)` (in-process
runs get a throwing stub).
