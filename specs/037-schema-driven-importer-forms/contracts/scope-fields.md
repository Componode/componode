# Contract: JSON Schema → scope control mapping

Input: `ImporterManifest.configSchema` (JSON Schema draft 2020-12,
emitted by `z.toJSONSchema` on `GET /importers` — stable since spec
036). Output: `ScopeField[]` descriptors rendered by `ScopeFields`.

## Property → control

| JSON Schema shape | `kind` | Control |
|---|---|---|
| `{type:"string"}` | `text` | `Input` |
| `{type:"string", format:"uri"}` | `url` | `Input type="url"` |
| `{type:"boolean"}` | `boolean` | `Switch` |
| `{enum:[...]}` / `{type:"string", enum:[...]}` | `enum` | `Select` |
| `{type:"number"}` / `{type:"integer"}` | `number` | `Input type="number"` |
| `{type:"array", items:{type:"string"}}` | `string-list` | list editor — one `Input` row per entry + add/remove |
| anything else (object, record, nested arrays, unions) | `json` | per-field JSON `Textarea` + parse error |

## Rules

1. `required[]` membership → required marker; empty submit blocked with
   an inline error naming the field.
2. `default` → initial control value on create; submits explicitly even
   untouched. On edit, the stored value wins; absent keys get the
   schema default.
3. Field order = `properties` declaration order.
4. Missing/non-object schema, or `properties` absent/empty →
   renderable-but-empty: form shows a "no scope options" state (the
   whole-section raw fallback only when the schema itself fails to
   deserialize as an object).
5. Stored keys ∉ `properties` → "Unrecognized fields" JSON sub-editor;
   values merge into the submitted scope unless the operator removes
   them.
6. Server `VALIDATION_FAILED` `details[].path` of `["scope", key]` →
   that field's error; other paths → scope-level error (existing
   `fieldErrors()` split).
7. Arrays whose `items` aren't plain `{type:"string"}` → `kind: "json"`.
8. `additionalProperties:false` changes nothing client-side — strict
   enforcement stays server-side; it is why unknown keys must be
   *visible* (rule 5).
