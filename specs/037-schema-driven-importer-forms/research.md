# Research: Schema-Driven Importer Forms

## What the API actually ships today

`GET /importers` and `GET /importers/:name/schema` (spec 036, F008)
serialize each manifest's `configSchema` via `z.toJSONSchema` (zod
4.6.7 → JSON Schema draft 2020-12). Verified against the 8 in-tree
config schemas:

| Importer | Top-level shapes the renderer must cover |
|---|---|
| github | required `string`; optional `format:uri`; `string[]`; `boolean`+default; `enum`+default; **`record`** (`environmentMapping` → per-field JSON fallback) |
| kubernetes, aws, azure | `string`+default, `string[]`+default, optional `format:uri` |
| web-url, api-url | required `format:uri` only |
| mcp-server | `string[]`+default, optional `format:uri` |
| alibaba-cloud | `string[]`+default, optional `string`, `enum`+default, `boolean`+default, regex `string`, `additionalProperties:false` |

Zod→JSON-Schema notes: `superRefine` URL-safety checks do **not**
serialize (server still enforces); `.optional()` = absent from
`required[]`; `.default(v)` surfaces as `default`; `.strict()` surfaces
as `additionalProperties:false` — the signal that unknown keys will 400,
which motivates the visible "unrecognized fields" block (D6) over
invisible carry-over.

## Decisions

- **Decision**: pure mapper module (`scope-schema.ts`) + thin renderer
  (`scope-fields.tsx`).
  **Rationale**: mapping logic is the risky part (enum detection,
  defaults, unknown keys) — pure functions get exhaustive unit tests
  without DOM; the renderer stays a mechanical descriptor→primitive
  switch. Matches `docs/ux.md` §5 mapper rule.
  **Alternatives considered**: generating controls inline in
  `importer-form.tsx` (rejected: untestable soup); a runtime JSON-Schema
  form library like react-jsonschema-form (rejected: new dependency,
  styling mismatch with shadcn, overkill for flat top-level fields).
- **Decision**: source of truth is `scopeValues: Record<string,unknown>`;
  raw-JSON mode is a serialized view of the same state.
  **Rationale**: single representation makes the typed↔raw toggle a
  pure serialize/parse — work is preserved in both directions (spec
  US2).
  **Alternatives considered**: two independent states synced on every
  keystroke (rejected: parse-error states can't sync, double the bug
  surface).
- **Decision**: per-field JSON sub-editor for unrenderable constructs,
  plus one "unrecognized fields" block for unknown stored keys.
  **Rationale**: degrade per field, not per importer — GitHub keeps
  typed controls for 13/14 properties.
  **Alternatives considered**: whole-scope raw fallback when any
  property is unrenderable (rejected: punishes GitHub, the biggest
  schema, to raw JSON).
- **Decision**: no new manifest metadata (labels/descriptions) — labels
  are humanized property names.
  **Rationale**: adding manifest fields would extend the importer
  contract surface (`ImporterManifest`, every package's manifest.ts,
  the agent lockstep handshake inputs) for cosmetic gain; out of scope.
  **Alternatives considered**: `title`/`description` annotations in the
  zod schemas (deferred: would need an ADR-065-adjacent contract note
  and 8 package edits; schemas carry no descriptions today — spec
  Assumptions).

## Open risks

- `z.toJSONSchema` output details (e.g. `additionalProperties:false` on
  strict objects, `default` placement) are verified by reading the
  emitted schema in the importer-registry test — add an assertion there
  if a shape assumption breaks.
- Number/integer controls: no in-tree schema uses them today; the
  mapping still implements them so future importers don't regress to
  raw JSON.
