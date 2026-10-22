import { useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { ApiError } from "@/api/client";
import { CREDENTIAL_KIND_META } from "@componode/core";
import type { CredentialKind, SecretRefMap } from "@/api/types";
import type { CreateCredentialInput } from "@/api/hooks/credentials";

export interface SecretEntry {
  key: string;
  value: string;
}

// Validates the editor rows into a secrets record. Returns either the
// secrets map or a user-facing error string.
export function collectSecrets(
  entries: SecretEntry[],
): { secrets: Record<string, string> } | { error: string } {
  const secrets: Record<string, string> = {};
  for (const entry of entries) {
    const key = entry.key.trim();
    if (!key && !entry.value) continue;
    if (!key) return { error: "Every secret value needs a key name" };
    if (secrets[key] !== undefined) return { error: `Duplicate secret key: ${key}` };
    if (!entry.value) return { error: `Secret "${key}" has an empty value` };
    secrets[key] = entry.value;
  }
  if (Object.keys(secrets).length === 0) {
    return { error: "Add at least one secret key/value" };
  }
  return { secrets };
}

// Shared shell for the dynamic key-row editors (secrets and secret refs):
// header text, keyed rows with a remove button, and a trailing add button.
// The render prop supplies each row's fields between the key input and the
// remove button.
interface EntryRowsProps<T extends { key: string }> {
  entries: T[];
  onChange: (entries: T[]) => void;
  makeEmpty: () => T;
  label: string;
  description: React.ReactNode;
  addLabel: string;
  removeLabel: (index: number) => string;
  children: (entry: T, index: number, setEntry: (index: number, patch: Partial<T>) => void) => React.ReactNode;
}

function EntryRows<T extends { key: string }>({
  entries,
  onChange,
  makeEmpty,
  label,
  description,
  addLabel,
  removeLabel,
  children,
}: EntryRowsProps<T>) {
  const setEntry = (index: number, patch: Partial<T>) =>
    onChange(entries.map((e, i) => (i === index ? { ...e, ...patch } : e)));

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <p className="text-xs text-muted-foreground">{description}</p>
      {entries.map((entry, i) => (
        <div key={i} className="flex items-center gap-2">
          {children(entry, i, setEntry)}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onChange(entries.filter((_, j) => j !== i))}
            disabled={entries.length === 1}
            aria-label={removeLabel(i)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...entries, makeEmpty()])}
      >
        <Plus className="mr-1 h-4 w-4" /> {addLabel}
      </Button>
    </div>
  );
}

interface SecretEntriesEditorProps {
  entries: SecretEntry[];
  onChange: (entries: SecretEntry[]) => void;
}

// Dynamic key/value rows for a write-only credential bundle.
export function SecretEntriesEditor({ entries, onChange }: SecretEntriesEditorProps) {
  return (
    <EntryRows
      entries={entries}
      onChange={onChange}
      makeEmpty={() => ({ key: "", value: "" })}
      label="Secret values"
      description={
        <>
          Stored encrypted and never shown again. Each key becomes available to
          importers by name (e.g. <code>token</code>).
        </>
      }
      addLabel="Add secret"
      removeLabel={(i) => `Remove secret ${i + 1}`}
    >
      {(entry, i, setEntry) => (
        <>
          <Input
            value={entry.key}
            onChange={(e) => setEntry(i, { key: e.target.value })}
            placeholder="key (e.g. token)"
            className="w-40"
            aria-label={`Secret key ${i + 1}`}
          />
          <Input
            value={entry.value}
            onChange={(e) => setEntry(i, { value: e.target.value })}
            placeholder="value"
            type="password"
            autoComplete="off"
            className="flex-1"
            aria-label={`Secret value ${i + 1}`}
          />
        </>
      )}
    </EntryRows>
  );
}

export interface SecretRefEntry {
  key: string;
  source: "env" | "file";
  reference: string;
}

// Validates editor rows into a secretRefMap. Rows name agent-host sources
// (env var or path under SECRETS_DIR) — never secret values (ADR-117).
export function collectSecretRefs(
  entries: SecretRefEntry[],
): { secretRefMap: SecretRefMap } | { error: string } {
  const refs: SecretRefMap = {};
  for (const entry of entries) {
    const key = entry.key.trim();
    const reference = entry.reference.trim();
    if (!key && !reference) continue;
    if (!key) return { error: "Every reference needs a key name" };
    if (refs[key] !== undefined) return { error: `Duplicate key: ${key}` };
    if (!reference) return { error: `Key "${key}" has an empty reference` };
    if (entry.source === "file") {
      if (reference.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(reference)) {
        return {
          error: `Key "${key}": file references must be relative to the agent's secrets directory`,
        };
      }
      refs[key] = { file: reference };
    } else {
      refs[key] = { env: reference };
    }
  }
  if (Object.keys(refs).length === 0) {
    return { error: "Add at least one secret reference" };
  }
  return { secretRefMap: refs };
}

interface SecretRefEntriesEditorProps {
  entries: SecretRefEntry[];
  onChange: (entries: SecretRefEntry[]) => void;
}

// Key + source-type + reference rows for an agent-managed credential.
export function SecretRefEntriesEditor({ entries, onChange }: SecretRefEntriesEditorProps) {
  return (
    <EntryRows
      entries={entries}
      onChange={onChange}
      makeEmpty={() => ({ key: "", source: "env" as const, reference: "" })}
      label="Secret references"
      description="Names of env vars or files under the agent's secrets directory. Secret values never leave the agent host."
      addLabel="Add reference"
      removeLabel={(i) => `Remove reference ${i + 1}`}
    >
      {(entry, i, setEntry) => (
        <>
          <Input
            value={entry.key}
            onChange={(e) => setEntry(i, { key: e.target.value })}
            placeholder="key (e.g. token)"
            className="w-40"
            aria-label={`Reference key ${i + 1}`}
          />
          <Select
            value={entry.source}
            onChange={(e) =>
              setEntry(i, { source: e.target.value as "env" | "file" })
            }
            className="w-28"
            aria-label={`Reference source ${i + 1}`}
          >
            <option value="env">env var</option>
            <option value="file">file</option>
          </Select>
          <Input
            value={entry.reference}
            onChange={(e) => setEntry(i, { reference: e.target.value })}
            placeholder={entry.source === "env" ? "VARIABLE_NAME" : "relative/path"}
            className="flex-1"
            aria-label={`Reference ${i + 1}`}
          />
        </>
      )}
    </EntryRows>
  );
}

interface CredentialFormProps {
  onSubmit: (input: CreateCredentialInput) => Promise<void>;
  onCancel: () => void;
  submitting: boolean;
  // Selector UI locks the kind to STORED when an execution mode doesn't
  // support agent-managed credentials (e.g. hub-executed configs).
  lockStored?: boolean;
}

// Write-only credential editor (spec 013): values are sent once to the API and
// never read back. The dynamic key/value editor stores a credential bundle.
export function CredentialForm({ onSubmit, onCancel, submitting, lockStored }: CredentialFormProps) {
  const baseId = useId();
  const [label, setLabel] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [kind, setKind] = useState<CredentialKind>("STORED");
  const [entries, setEntries] = useState<SecretEntry[]>([{ key: "", value: "" }]);
  const [refEntries, setRefEntries] = useState<SecretRefEntry[]>([
    { key: "", source: "env", reference: "" },
  ]);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!label.trim()) {
      setError("Label is required");
      return;
    }

    const base = { label: label.trim(), expiresAt: expiresAt || null };
    try {
      if (kind === "AGENT_MANAGED") {
        const collected = collectSecretRefs(refEntries);
        if ("error" in collected) {
          setError(collected.error);
          return;
        }
        await onSubmit({ ...base, kind, secretRefMap: collected.secretRefMap });
      } else {
        const collected = collectSecrets(entries);
        if ("error" in collected) {
          setError(collected.error);
          return;
        }
        await onSubmit({ ...base, kind, secrets: collected.secrets });
      }
    } catch (err) {
      setError((err as ApiError).message ?? "Failed to create credential");
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" data-testid="credential-form">
      {error && <p className="text-sm text-destructive">{error}</p>}

      <div>
        <Label htmlFor={`${baseId}-label`}>Label</Label>
        <Input
          id={`${baseId}-label`}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. GitHub PAT — production"
          autoFocus
        />
      </div>

      <div>
        <Label htmlFor={`${baseId}-expiresAt`}>Expires at (optional)</Label>
        <Input
          id={`${baseId}-expiresAt`}
          type="date"
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
        />
      </div>

      <div>
        <Label htmlFor={`${baseId}-kind`}>Where do the values live?</Label>
        <Select
          id={`${baseId}-kind`}
          value={kind}
          onChange={(e) => setKind(e.target.value as CredentialKind)}
          disabled={lockStored}
        >
          <option value="STORED">{CREDENTIAL_KIND_META.STORED.label}</option>
          <option value="AGENT_MANAGED">
            {CREDENTIAL_KIND_META.AGENT_MANAGED.label}
          </option>
        </Select>
        <p className="mt-1 text-xs text-muted-foreground">
          {CREDENTIAL_KIND_META[kind].description}
        </p>
      </div>

      {kind === "AGENT_MANAGED" ? (
        <SecretRefEntriesEditor entries={refEntries} onChange={setRefEntries} />
      ) : (
        <SecretEntriesEditor entries={entries} onChange={setEntries} />
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={submitting}>
          {submitting ? "Saving…" : "Create credential"}
        </Button>
      </div>
    </form>
  );
}
