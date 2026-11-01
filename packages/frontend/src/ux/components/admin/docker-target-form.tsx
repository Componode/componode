import { Input } from "@/ux/components/ui/input";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/ux/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/ux/components/ui/select";
import { Textarea } from "@/ux/components/ui/textarea";

export type Transport = "socket" | "tcp" | "ssh" | "context";

const TRANSPORTS: { value: Transport; label: string; description: string }[] = [
  { value: "socket", label: "Local socket / named pipe", description: "Unix socket or Windows named pipe on the Hub host." },
  { value: "tcp", label: "TCP (mutual TLS)", description: "HTTPS-only. Client cert and key come from linked stored credentials." },
  { value: "ssh", label: "SSH (pinned host key)", description: "docker system dial-stdio with a SHA-256 host-key pin." },
  { value: "context", label: "Named Docker context", description: "A context provisioned in the Hub's Docker context store." },
];

interface FieldDef { key: string; label: string; required?: boolean; number?: boolean; placeholder?: string; hint?: string }
const TRANSPORT_FIELDS: Record<Transport, FieldDef[]> = {
  socket: [{ key: "path", label: "Socket or pipe path", required: true, placeholder: "/var/run/docker.sock or //./pipe/docker_engine", hint: "Absolute path; no .. segments." }],
  tcp: [
    { key: "host", label: "Host", required: true },
    { key: "port", label: "Port", required: true, number: true, placeholder: "2376" },
    { key: "caCertKey", label: "CA cert key", hint: "Credential key name — only for private CAs." },
    { key: "clientCertKey", label: "Client cert key", required: true, hint: "Credential key name." },
    { key: "clientKeyKey", label: "Client key key", required: true, hint: "Credential key name." },
  ],
  ssh: [
    { key: "host", label: "Host", required: true },
    { key: "port", label: "Port", number: true, placeholder: "22" },
    { key: "user", label: "User", required: true },
    { key: "hostKeySha256", label: "Host key SHA-256 pin", required: true },
    { key: "privateKeyKey", label: "Private key key", required: true, hint: "Credential key name." },
    { key: "passphraseKey", label: "Passphrase key", hint: "Credential key name, optional." },
  ],
  context: [{ key: "name", label: "Context name", required: true, hint: "The 'default' context is not allowed." }],
};

export interface DockerTargetFormValue {
  targetId: string;
  label: string;
  description: string;
  transport: Transport;
  fields: Record<string, string>;
}

export function emptyDockerTargetForm(): DockerTargetFormValue {
  return { targetId: "", label: "", description: "", transport: "socket", fields: {} };
}

export function dockerProfileFrom(v: DockerTargetFormValue): Record<string, unknown> | null {
  const out: Record<string, unknown> = { transport: v.transport };
  for (const f of TRANSPORT_FIELDS[v.transport]) {
    const raw = (v.fields[f.key] ?? "").trim();
    if (f.required && !raw) return null;
    if (!raw) continue;
    out[f.key] = f.number ? Number(raw) : raw;
  }
  return out;
}

export function dockerFormErrors(v: DockerTargetFormValue): Record<string, string> {
  const e: Record<string, string> = {};
  if (!v.targetId.trim()) e.targetId = "Target ID is required.";
  else if (v.targetId.trim().length > 200) e.targetId = "Target ID must be 200 characters or fewer.";
  if (!v.label.trim()) e.label = "Label is required.";
  for (const f of TRANSPORT_FIELDS[v.transport]) {
    const raw = (v.fields[f.key] ?? "").trim();
    if (f.required && !raw) e[`profile.${f.key}`] = `${f.label} is required.`;
    else if (f.number && raw && !/^\d+$/.test(raw)) e[`profile.${f.key}`] = `${f.label} must be a number.`;
  }
  return e;
}

export function DockerTargetForm({
  value,
  onChange,
  errors,
  editing,
}: {
  value: DockerTargetFormValue;
  onChange: (v: DockerTargetFormValue) => void;
  errors: Record<string, string>;
  editing?: boolean;
}) {
  const set = (k: keyof DockerTargetFormValue, v: string) => onChange({ ...value, [k]: v });
  const setField = (k: string, v: string) => onChange({ ...value, fields: { ...value.fields, [k]: v } });
  return (
    <FieldGroup>
      <Field data-invalid={errors.targetId ? true : undefined}>
        <FieldLabel htmlFor="dt-id">Target ID <span className="text-destructive">*</span></FieldLabel>
        <Input id="dt-id" value={value.targetId} disabled={editing} onChange={(e) => set("targetId", e.target.value)} placeholder="prod-docker-1" aria-invalid={errors.targetId ? true : undefined} />
        <FieldDescription>Immutable selector referenced by importer configs. 1–200 characters.</FieldDescription>
        {errors.targetId && <FieldError>{errors.targetId}</FieldError>}
      </Field>
      <Field data-invalid={errors.label ? true : undefined}>
        <FieldLabel htmlFor="dt-label">Label <span className="text-destructive">*</span></FieldLabel>
        <Input id="dt-label" value={value.label} onChange={(e) => set("label", e.target.value)} placeholder="Production Docker" aria-invalid={errors.label ? true : undefined} />
        {errors.label && <FieldError>{errors.label}</FieldError>}
      </Field>
      <Field>
        <FieldLabel htmlFor="dt-desc">Description</FieldLabel>
        <Textarea id="dt-desc" value={value.description} onChange={(e) => set("description", e.target.value)} rows={2} />
      </Field>
      {!editing && (
        <>
          <Field>
            <FieldLabel htmlFor="dt-transport">Transport</FieldLabel>
            <Select value={value.transport} onValueChange={(t) => onChange({ ...value, transport: t as Transport, fields: {} })}>
              <SelectTrigger id="dt-transport" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TRANSPORTS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <FieldDescription>{TRANSPORTS.find((t) => t.value === value.transport)?.description}</FieldDescription>
          </Field>
          {TRANSPORT_FIELDS[value.transport].map((f) => (
            <Field key={f.key} data-invalid={errors[`profile.${f.key}`] ? true : undefined}>
              <FieldLabel htmlFor={`dt-f-${f.key}`}>{f.label}{f.required && <span className="text-destructive"> *</span>}</FieldLabel>
              <Input id={`dt-f-${f.key}`} value={value.fields[f.key] ?? ""} onChange={(e) => setField(f.key, e.target.value)} placeholder={f.placeholder} aria-invalid={errors[`profile.${f.key}`] ? true : undefined} />
              {f.hint && <FieldDescription>{f.hint}</FieldDescription>}
              {errors[`profile.${f.key}`] && <FieldError>{errors[`profile.${f.key}`]}</FieldError>}
            </Field>
          ))}
        </>
      )}
    </FieldGroup>
  );
}
