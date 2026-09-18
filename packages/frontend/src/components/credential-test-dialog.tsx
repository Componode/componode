import { useState } from "react";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useImporters } from "@/api/hooks/importers";
import { useTestCredential } from "@/api/hooks/credentials";
import type { Credential, CredentialTestResult } from "@/api/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";

interface CredentialTestDialogProps {
  credential: Credential | null;
  onClose: () => void;
}

// Dry-run a stored credential against an importer's auth check (spec 013 US3).
// Only importers that declare secret keys are offered — others cannot consume
// a credential bundle. The result never contains secret material.
export function CredentialTestDialog({ credential, onClose }: CredentialTestDialogProps) {
  const { data: importersData } = useImporters();
  const test = useTestCredential(credential?.id ?? "");
  const [importerName, setImporterName] = useState("");
  const [result, setResult] = useState<CredentialTestResult | null>(null);

  const testableImporters = (importersData?.importers ?? []).filter(
    (m) => (m.secrets?.length ?? 0) > 0,
  );

  const runTest = async () => {
    setResult(null);
    const res = await test.mutateAsync({ importerName });
    setResult(res);
  };

  return (
    <Dialog open={credential !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Test credential</DialogTitle>
          <DialogDescription>
            Dry-run &quot;{credential?.label}&quot; against an importer&apos;s
            authentication check. No data is imported.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label htmlFor="test-importer">Importer</Label>
          <Select
            id="test-importer"
            value={importerName}
            onChange={(e) => setImporterName(e.target.value)}
          >
            <option value="">Select an importer</option>
            {testableImporters.map((m) => (
              <option key={m.name} value={m.name}>
                {m.label}
              </option>
            ))}
          </Select>
        </div>

        {result && (
          <div
            className={
              result.ok
                ? "flex items-start gap-2 rounded-md border border-green-600/40 bg-green-600/10 p-3 text-sm"
                : "flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm"
            }
          >
            {result.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-green-600" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 text-destructive" />
            )}
            <span>{result.ok ? "Authentication succeeded." : result.error}</span>
          </div>
        )}

        {test.isError && (
          <p className="text-sm text-destructive">
            {test.error instanceof Error ? test.error.message : "Test failed"}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={runTest} disabled={!importerName || test.isPending}>
            {test.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Run test
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
