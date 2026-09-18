import { useId, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ApiError } from "@/api/client";
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

interface SecretEntriesEditorProps {
  entries: SecretEntry[];
  onChange: (entries: SecretEntry[]) => void;
}

// Dynamic key/value rows for a write-only credential bundle.
export function SecretEntriesEditor({ entries, onChange }: SecretEntriesEditorProps) {
  function setEntry(index: number, patch: Partial<SecretEntry>) {
    onChange(entries.map((e, i) => (i === index ? { ...e, ...patch } : e)));
  }

  return (
    <div className="space-y-2">
      <Label>Secret values</Label>
      <p className="text-xs text-muted-foreground">
        Stored encrypted and never shown again. Each key becomes available to
        importers by name (e.g. <code>token</code>).
      </p>
      {entries.map((entry, i) => (
        <div key={i} className="flex items-center gap-2">
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
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => onChange(entries.filter((_, j) => j !== i))}
            disabled={entries.length === 1}
            aria-label={`Remove secret ${i + 1}`}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...entries, { key: "", value: "" }])}
      >
        <Plus className="mr-1 h-4 w-4" /> Add secret
      </Button>
    </div>
  );
}

interface CredentialFormProps {
  onSubmit: (input: CreateCredentialInput) => Promise<void>;
  onCancel: () => void;
  submitting: boolean;
}

// Write-only credential editor (spec 013): values are sent once to the API and
// never read back. The dynamic key/value editor stores a credential bundle.
export function CredentialForm({ onSubmit, onCancel, submitting }: CredentialFormProps) {
  const baseId = useId();
  const [label, setLabel] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [entries, setEntries] = useState<SecretEntry[]>([{ key: "", value: "" }]);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const collected = collectSecrets(entries);
    if ("error" in collected) {
      setError(collected.error);
      return;
    }
    if (!label.trim()) {
      setError("Label is required");
      return;
    }

    try {
      await onSubmit({
        label: label.trim(),
        expiresAt: expiresAt || null,
        secrets: collected.secrets,
      });
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

      <SecretEntriesEditor entries={entries} onChange={setEntries} />

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
