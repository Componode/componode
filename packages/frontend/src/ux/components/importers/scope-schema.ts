// JSON Schema → scope field descriptors for the importer form (spec 037,
// contracts/scope-fields.md). `configSchema` arrives as draft-2020-12 JSON
// Schema via z.toJSONSchema server-side; only top-level properties get
// dedicated controls — everything else degrades to a per-field JSON editor.

export type ScopeFieldKind =
  | "text"
  | "url"
  | "boolean"
  | "enum"
  | "number"
  | "string-list"
  | "json";

export interface ScopeField {
  key: string;
  label: string;
  kind: ScopeFieldKind;
  required: boolean;
  options?: (string | number)[];
  default?: unknown;
  description?: string;
}

interface JsonSchemaProperty {
  type?: string;
  format?: string;
  enum?: unknown[];
  items?: { type?: string };
  default?: unknown;
  description?: string;
}

interface JsonSchemaObject {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
}

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const ACRONYMS: Record<string, string> = {
  url: "URL",
  uri: "URI",
  id: "ID",
  ids: "IDs",
  api: "API",
  tls: "TLS",
  acm: "ACM",
  arn: "ARN",
  cidr: "CIDR",
  vpc: "VPC",
};

// "includeForks" → "Include forks"; "baseUrl" → "Base URL"; known
// initialisms stay uppercase.
function humanize(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (ACRONYMS[lower]) return ACRONYMS[lower];
      if (/^[A-Z0-9]+$/.test(w)) return w;
      return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : lower;
    })
    .join(" ");
}

const isEnumOptions = (v: unknown[]): v is (string | number)[] =>
  v.length > 0 && v.every((o) => typeof o === "string" || typeof o === "number");

function kindFor(prop: JsonSchemaProperty): ScopeFieldKind {
  if (Array.isArray(prop.enum) && isEnumOptions(prop.enum)) {
    return "enum";
  }
  switch (prop.type) {
    case "string":
      return prop.format === "uri" || prop.format === "url" ? "url" : "text";
    case "boolean":
      return "boolean";
    case "number":
    case "integer":
      return "number";
    case "array":
      return prop.items?.type === "string" ? "string-list" : "json";
    default:
      return "json";
  }
}

/** True when the schema is an object shape — properties may be absent. */
export function schemaRenderable(schema: unknown): boolean {
  return isRecord(schema) && schema.type === "object";
}

/** One descriptor per top-level property, in declaration order. */
export function fieldsForSchema(schema: unknown): ScopeField[] {
  if (!isRecord(schema) || schema.type !== "object" || !isRecord(schema.properties)) {
    return [];
  }
  const s = schema as JsonSchemaObject;
  const required = new Set(Array.isArray(s.required) ? s.required : []);
  return Object.entries(s.properties as Record<string, JsonSchemaProperty>).map(
    ([key, prop]) => ({
      key,
      label: humanize(key),
      kind: kindFor(prop ?? {}),
      required: required.has(key),
      options:
        Array.isArray(prop?.enum) && isEnumOptions(prop.enum)
          ? prop.enum
          : undefined,
      default: prop?.default,
      description: typeof prop?.description === "string" ? prop.description : undefined,
    }),
  );
}

/**
 * Initial typed values on create: schema defaults materialized, `""` for
 * required fields without a default, nothing for optional fields (an
 * absent optional key must never submit as `""`).
 */
export function defaultsFor(fields: ScopeField[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.default !== undefined) out[f.key] = f.default;
    else if (f.required) out[f.key] = "";
  }
  return out;
}

/**
 * Typed values → submitted scope. Optional `""`/undefined values are
 * omitted; numbers coerce; `extras` (unrecognized stored keys) merge in.
 */
export function scopeFromValues(
  fields: ScopeField[],
  values: Record<string, unknown>,
  extras?: Record<string, unknown>,
): Record<string, unknown> {
  const scope: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.key];
    if (v === undefined) continue;
    if (f.kind === "number") {
      if (v === "") continue;
      const n = Number(v);
      if (!Number.isNaN(n)) scope[f.key] = n;
      else if (f.required) scope[f.key] = v;
      continue;
    }
    if (v === "" && !f.required) continue;
    if (f.kind === "string-list" && Array.isArray(v)) {
      // blank/whitespace rows are editing artifacts, not values
      scope[f.key] = v.filter(
        (s) => typeof s !== "string" || s.trim() !== "",
      );
      continue;
    }
    scope[f.key] = v;
  }
  return { ...scope, ...(extras ?? {}) };
}

/** Stored scope keys the schema doesn't declare — the "unrecognized fields" set. */
export function unknownKeys(
  stored: Record<string, unknown>,
  schema: unknown,
): Record<string, unknown> {
  if (!isRecord(schema) || schema.type !== "object") return {};
  if (!isRecord(schema.properties)) {
    // No declared properties: every stored key is unrecognized — they must
    // surface in the block, never drop silently into an empty submission.
    return { ...stored };
  }
  const known = new Set(Object.keys(schema.properties));
  return Object.fromEntries(Object.entries(stored).filter(([k]) => !known.has(k)));
}
