import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/ux/components/ui/field"
import { Input } from "@/ux/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ux/components/ui/select"
import { Switch } from "@/ux/components/ui/switch"
import { Textarea } from "@/ux/components/ui/textarea"
import { Button } from "@/ux/components/ui/button"
import { PlusIcon, XIcon } from "lucide-react"
import type { ScopeField } from "./scope-schema"

const UNSET = "__unset__"

export interface ScopeFieldsProps {
  fields: ScopeField[]
  values: Record<string, unknown>
  /** Raw JSON text per `kind:"json"` field (controlled by the parent). */
  jsonTexts: Record<string, string>
  fieldErrors: Record<string, string>
  onValue: (key: string, value: unknown) => void
  onJsonText: (key: string, text: string) => void
  /** Stored keys outside the schema — the "Unrecognized fields" block. */
  unknownText: string
  unknownError?: string
  onUnknownText: (text: string) => void
}

const Required = () => <span className="text-destructive"> *</span>

function StringListField({
  field,
  value,
  error,
  onChange,
}: {
  field: ScopeField
  value: string[]
  error?: string
  onChange: (v: string[]) => void
}) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel>
        {field.label}
        {field.required && <Required />}
      </FieldLabel>
      <div className="flex flex-col gap-2">
        {value.map((entry, i) => (
          <div key={i} className="flex items-center gap-2">
            <Input
              id={`i-scope-${field.key}-${i}`}
              value={entry}
              aria-label={`${field.label} ${i + 1}`}
              aria-invalid={error ? true : undefined}
              onChange={(e) => onChange(value.map((v, j) => (j === i ? e.target.value : v)))}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={`Remove ${field.label} ${i + 1}`}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <XIcon />
            </Button>
          </div>
        ))}
        <div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange([...value, ""])}
          >
            <PlusIcon data-icon="inline-start" />
            Add {value.length ? "another" : "entry"}
          </Button>
        </div>
      </div>
      {field.description && <FieldDescription>{field.description}</FieldDescription>}
      {error && <FieldError>{error}</FieldError>}
    </Field>
  )
}

export function ScopeFields({
  fields,
  values,
  jsonTexts,
  fieldErrors,
  onValue,
  onJsonText,
  unknownText,
  unknownError,
  onUnknownText,
}: ScopeFieldsProps) {
  return (
    <FieldGroup>
      {fields.map((field) => {
        const id = `i-scope-${field.key}`
        const error = fieldErrors[field.key]
        const invalid = error ? true : undefined
        switch (field.kind) {
          case "boolean":
            return (
              <Field key={field.key} orientation="horizontal" data-invalid={invalid}>
                <Switch
                  id={id}
                  aria-label={field.label}
                  checked={Boolean(values[field.key])}
                  onCheckedChange={(v) => onValue(field.key, v)}
                />
                <div className="flex flex-col gap-0.5">
                  <FieldLabel htmlFor={id}>
                    {field.label}
                    {field.required && <Required />}
                  </FieldLabel>
                  {field.description && <FieldDescription>{field.description}</FieldDescription>}
                  {error && <FieldError>{error}</FieldError>}
                </div>
              </Field>
            )
          case "enum": {
            const current = (values[field.key] as string) ?? ""
            return (
              <Field key={field.key} data-invalid={invalid}>
                <FieldLabel htmlFor={id}>
                  {field.label}
                  {field.required && <Required />}
                </FieldLabel>
                <Select
                  value={current === "" ? UNSET : current}
                  onValueChange={(v) => onValue(field.key, v === UNSET ? undefined : v)}
                >
                  <SelectTrigger id={id} className="w-full" aria-label={field.label} aria-invalid={invalid}>
                    <SelectValue placeholder="Select…" />
                  </SelectTrigger>
                  <SelectContent>
                    {!field.required && <SelectItem value={UNSET}>Not set</SelectItem>}
                    {(field.options ?? []).map((opt) => (
                      <SelectItem key={opt} value={opt}>
                        {opt}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {field.description && <FieldDescription>{field.description}</FieldDescription>}
                {error && <FieldError>{error}</FieldError>}
              </Field>
            )
          }
          case "string-list":
            return (
              <StringListField
                key={field.key}
                field={field}
                value={Array.isArray(values[field.key]) ? (values[field.key] as string[]) : []}
                error={error}
                onChange={(v) => onValue(field.key, v)}
              />
            )
          case "json":
            return (
              <Field key={field.key} data-invalid={invalid}>
                <FieldLabel htmlFor={id}>
                  {field.label} (JSON)
                  {field.required && <Required />}
                </FieldLabel>
                <Textarea
                  id={id}
                  value={jsonTexts[field.key] ?? ""}
                  onChange={(e) => onJsonText(field.key, e.target.value)}
                  rows={4}
                  className="font-mono text-xs"
                  aria-invalid={invalid}
                  placeholder="{}"
                />
                {field.description && <FieldDescription>{field.description}</FieldDescription>}
                {error ? (
                  <FieldError>{error}</FieldError>
                ) : (
                  <FieldDescription>
                    Key/value object — this field has no dedicated editor yet.
                  </FieldDescription>
                )}
              </Field>
            )
          default:
            return (
              <Field key={field.key} data-invalid={invalid}>
                <FieldLabel htmlFor={id}>
                  {field.label}
                  {field.required && <Required />}
                </FieldLabel>
                <Input
                  id={id}
                  type={field.kind === "url" ? "url" : field.kind === "number" ? "number" : "text"}
                  value={(values[field.key] as string | number) ?? ""}
                  required={field.required}
                  aria-required={field.required}
                  aria-invalid={invalid}
                  onChange={(e) => onValue(field.key, e.target.value)}
                />
                {field.description && <FieldDescription>{field.description}</FieldDescription>}
                {error && <FieldError>{error}</FieldError>}
              </Field>
            )
        }
      })}
      {(unknownText !== "" || unknownError) && (
        <Field data-invalid={unknownError ? true : undefined}>
          <FieldLabel htmlFor="i-scope-unknown">Unrecognized fields</FieldLabel>
          <Textarea
            id="i-scope-unknown"
            value={unknownText}
            onChange={(e) => onUnknownText(e.target.value)}
            rows={3}
            className="font-mono text-xs"
            aria-invalid={unknownError ? true : undefined}
            placeholder="{}"
          />
          {unknownError ? (
            <FieldError>{unknownError}</FieldError>
          ) : (
            <FieldDescription>
              Scope keys not in this importer's schema — preserved on save unless removed.
            </FieldDescription>
          )}
        </Field>
      )}
    </FieldGroup>
  )
}
