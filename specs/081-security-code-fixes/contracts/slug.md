# Contract: `slugify`

```
slugify(input: string, maxLength?: number): string
```

Owner: `packages/core` (exported from `@componode/core` root).

## Behavior

1. `input.toLowerCase().trim()`
2. Collapse every run of non-`[a-z0-9]` characters to a single `-`
3. Strip a leading and/or trailing `-` if present (at most one each, since
   step 2 leaves runs of length ≤ 1)
4. If `maxLength` given and result is longer: `slice(0, maxLength)`, then
   strip a trailing `-` if the cut left one

Guarantees: O(n) time on all inputs; no regex applied to `-` repetitions;
returns `""` for inputs with no `a-z0-9` content (callers keep their own
fallbacks: `"unknown"`, `"credential"`, `"resource"`, …).

## Reference cases (normative)

| Input | `slugify(input)` | `slugify(input, 100)` note |
|---|---|---|
| `"My Cool Repo!"` | `"my-cool-repo"` | |
| `"  --Foo Bar--  "` | `"foo-bar"` | |
| `"a!!!b"` | `"a-b"` | |
| `"---"` | `""` | caller fallback applies |
| `""` | `""` | caller fallback applies |
| `"héllo wörld"` | `"h-llo-w-rld"` | non-Latin collapses |
| `"x" * 200` | 200 chars | `slugify(…, 100)` → 100 `x` |
| `"a" + "-" + "b"*200` | `"a-" + 200 b` | `,100` → `"a-" + 99 b` (no trailing `-`) |
| `"-" * 1_000_000` | `""` | completes well under 1 s |

## Callers

| Caller | Usage | Fallback |
|---|---|---|
| `backend utils/slug.ts` | re-exported for `generateUniqueSlug` / `generateComponentSlug` / `generateInstanceSlug` | `"unknown"`, `"default"` |
| `product-service.toSlug`, `org-service.toSlug` | `slugify(name, 100)` | none (empty allowed → conflict-check handles) |
| `credential-service.deriveCredentialSlug` | `slugify(label)` | `"credential"` |
| importers aws/azure/kubernetes/mcp-server | `slugify(name)` | n/a (names are templated) |
| importer-github `github-extras.ts` ×2 | `slugify(template)` | n/a |
| importer-alibaba-cloud `mapping.ts` | `slugify(name)` + `slugify(suffix)` | `"resource"`, `"id"` |
| frontend `ux/lib/slug.ts` `deriveSlug` | mirrored implementation (research D8) | n/a |

## Explicitly not migrated

- `user-service.ts` — username slug semantics (allows `_`, charwise, no
  trim) differ deliberately (research D3).
