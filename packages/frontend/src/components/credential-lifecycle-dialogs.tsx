import { useState } from "react";
import {
  useCredential,
  useDeleteCredential,
  useUpdateCredential,
} from "@/api/hooks/credentials";
import type { ApiError } from "@/api/client";
import type { Credential, CredentialDependents } from "@/api/types";
import {
  collectSecrets,
  SecretEntriesEditor,
  type SecretEntry,
} from "@/components/credential-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { relativeTime, absoluteTime } from "@/lib/format";

interface DialogProps {
  credential: Credential | null;
  onClose: () => void;
}

// Rotate: replace the stored secret bundle in place. The credential id and
// all importer-config links are preserved (spec 013 US4).
export function RotateCredentialDialog({ credential, onClose }: DialogProps) {
  const update = useUpdateCredential(credential?.id ?? "");
  const [entries, setEntries] = useState<SecretEntry[]>([{ key: "", value: "" }]);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const collected = collectSecrets(entries);
    if ("error" in collected) {
      setError(collected.error);
      return;
    }
    try {
      await update.mutateAsync({ secrets: collected.secrets });
      onClose();
    } catch (err) {
      setError((err as ApiError).message ?? "Rotation failed");
    }
  };

  return (
    <Dialog open={credential !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rotate credential</DialogTitle>
          <DialogDescription>
            Replace the secrets stored in &quot;{credential?.label}&quot;. The
            credential id and its importer-config links are preserved — the new
            values take effect on the next run.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-destructive">{error}</p>}
        <SecretEntriesEditor entries={entries} onChange={setEntries} />

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={update.isPending}>
            {update.isPending ? "Rotating…" : "Rotate"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Revoke: one-way status transition. Revoked credentials fail resolution.
export function RevokeCredentialDialog({ credential, onClose }: DialogProps) {
  const update = useUpdateCredential(credential?.id ?? "");
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setError(null);
    try {
      await update.mutateAsync({ status: "REVOKED" });
      onClose();
    } catch (err) {
      setError((err as ApiError).message ?? "Revoke failed");
    }
  };

  return (
    <Dialog open={credential !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke credential</DialogTitle>
          <DialogDescription>
            Revoking &quot;{credential?.label}&quot; is permanent — importer
            runs that reference it will fail until the config is updated.
            This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={update.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={update.isPending}>
            {update.isPending ? "Revoking…" : "Revoke"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Detail: read-only view answering "which imports use this credential, and
// when was it last used?" (spec 013 SC-005) — metadata + dependents without
// triggering a rejected delete.
export function CredentialDetailDialog({ credential, onClose }: DialogProps) {
  const detail = useCredential(credential?.id ?? null);
  const dependents = detail.data?.dependents;

  return (
    <Dialog open={credential !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{credential?.label}</DialogTitle>
          <DialogDescription>
            Credential detail — stored values are never shown, only key hints.
          </DialogDescription>
        </DialogHeader>

        {credential && (
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Status</dt>
              <dd>
                <Badge variant={credential.status === "ACTIVE" ? "default" : "destructive"}>
                  {credential.status}
                </Badge>
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Keys</dt>
              <dd className="flex flex-wrap justify-end gap-1">
                {Object.entries(credential.keyHints).map(([key, hint]) => (
                  <Badge key={key} variant="outline" className="font-mono text-xs">
                    {key} •••{hint}
                  </Badge>
                ))}
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Expires</dt>
              <dd>{credential.expiresAt ? absoluteTime(credential.expiresAt) : "never"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Last used</dt>
              <dd>{credential.lastUsedAt ? relativeTime(credential.lastUsedAt) : "never"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Created</dt>
              <dd>{absoluteTime(credential.createdAt)}</dd>
            </div>

            <div>
              <dt className="mb-1 text-muted-foreground">Used by</dt>
              <dd>
                {detail.isPending && (
                  <span className="text-muted-foreground">Loading dependents…</span>
                )}
                {dependents &&
                  dependents.importerConfigs.length === 0 &&
                  !dependents.oidc && (
                    <span className="text-muted-foreground">No references</span>
                  )}
                {dependents && (
                  <ul className="list-disc pl-5">
                    {dependents.importerConfigs.map((c) => (
                      <li key={c.id}>Importer config: {c.label}</li>
                    ))}
                    {dependents.oidc && <li>OIDC configuration</li>}
                  </ul>
                )}
              </dd>
            </div>
          </dl>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Delete: blocked while the credential is referenced. On 409 the problem
// details list the dependents so the user can unlink them.
export function DeleteCredentialDialog({ credential, onClose }: DialogProps) {
  const del = useDeleteCredential();
  const [dependents, setDependents] = useState<CredentialDependents | null>(null);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    if (!credential) return;
    setError(null);
    setDependents(null);
    try {
      await del.mutateAsync(credential.id);
      onClose();
    } catch (err) {
      const apiErr = err as ApiError;
      if (apiErr.code === "CREDENTIAL_IN_USE" && apiErr.details) {
        setDependents(apiErr.details as CredentialDependents);
      } else {
        setError(apiErr.message ?? "Delete failed");
      }
    }
  };

  return (
    <Dialog open={credential !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete credential</DialogTitle>
          <DialogDescription>
            Permanently delete &quot;{credential?.label}&quot; and its stored
            secrets. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

        {dependents && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
            <p className="font-medium">This credential is still in use:</p>
            <ul className="mt-1 list-disc pl-5">
              {dependents.importerConfigs.map((c) => (
                <li key={c.id}>Importer config: {c.label}</li>
              ))}
              {dependents.oidc && <li>OIDC configuration</li>}
            </ul>
            <p className="mt-1 text-muted-foreground">
              Remove the credential from these dependents before deleting.
            </p>
          </div>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={del.isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={confirm} disabled={del.isPending}>
            {del.isPending ? "Deleting…" : "Delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
