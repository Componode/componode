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
8. **URL-fetching importers must use `urlSafetyError` from `@componode/core`.** Any importer config field that accepts a URL to fetch must validate it with the shared SSRF guard (applied via `.superRefine` on the Zod config schema, as `importer-web-url` and `importer-api-url` do). It rejects non-HTTP(S) schemes, `localhost`, `.local`, loopback/private/link-local/CGNAT IPv4, IPv6 loopback/ULA/link-local, and cloud-metadata addresses. The guard checks the URL *as written* and cannot prevent DNS rebinding — a public hostname may resolve to a private address at request time — so deployments that expose importer configuration should additionally restrict container egress (see ADR-106).

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
import type { DiscoveredAsset, Importer, ImporterContext } from "@componode/core";
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
3. Add the package to `packages/backend/package.json` as a `workspace:*` dependency.
4. Register the package in `packages/backend/src/services/importer-registry.ts`:

   ```ts
   const IMPORTER_PACKAGES = [
     "@componode/importer-github",
     "@componode/importer-<provider>",
   ];
   ```

5. Run `pnpm install`, `pnpm -r build`, and `pnpm -r typecheck`.
6. Add unit tests for the new importer and an integration test through the backend run service.

---

## Testing checklist

- [ ] Unit tests mock the external SDK and verify yielded `DiscoveredAsset` records.
- [ ] Unit tests verify `AbortSignal` stops iteration cleanly.
- [ ] Integration test triggers a run through the backend and verifies DB rows.
- [ ] `pnpm build` and `pnpm typecheck` pass for the new package.
