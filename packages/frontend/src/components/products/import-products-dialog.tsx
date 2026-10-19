import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useBootstrapProducts } from "@/api/hooks/products";
import { describeApiError, type ApiError } from "@/api/client";
import type { BootstrapReport } from "@/api/types";

interface Props {
  open: boolean;
  onClose: () => void;
}

function ReportCounts({ report }: { report: BootstrapReport }) {
  return (
    <p className="text-sm">
      {report.created} created, {report.updated} updated, {report.edgesAdded}{" "}
      edge{report.edgesAdded === 1 ? "" : "s"} added
      {report.skipped.length > 0 ? `, ${report.skipped.length} skipped` : ""}
    </p>
  );
}

function SkippedList({ report }: { report: BootstrapReport }) {
  if (report.skipped.length === 0) return null;
  return (
    <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-input p-2 text-sm">
      {report.skipped.map((s, i) => (
        <li key={i}>
          <span className="font-medium">{s.item}</span>
          <span className="ml-2 text-muted-foreground">{s.reason}</span>
        </li>
      ))}
    </ul>
  );
}

function issueText(issue: { path?: (string | number)[]; message?: string }): string {
  const field = issue.path?.length ? `${issue.path.join(".")}: ` : "";
  return `${field}${issue.message ?? "Invalid value"}`;
}

/** SC-002: a rejected document surfaces every malformed item, not just the first. */
function ValidationIssueList({ error }: { error: ApiError }) {
  if (error.code !== "VALIDATION_FAILED" || !Array.isArray(error.details)) return null;
  const issues = error.details as { path?: (string | number)[]; message?: string }[];
  if (issues.length <= 1) return null;
  return (
    <ul className="max-h-32 space-y-0.5 overflow-y-auto rounded-md border border-input p-2 text-xs">
      {issues.map((issue, i) => (
        <li key={i}>{issueText(issue)}</li>
      ))}
    </ul>
  );
}

/**
 * ADR-114 catalog bootstrap: file selection triggers a dry-run preview of
 * the report; "Apply" commits the same document. The whole document is
 * validated before anything is written.
 */
export function ImportProductsDialog({ open, onClose }: Props) {
  const bootstrap = useBootstrapProducts();
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileText, setFileText] = useState<string | null>(null);
  const [preview, setPreview] = useState<BootstrapReport | null>(null);
  const [finalReport, setFinalReport] = useState<BootstrapReport | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    if (open) {
      setFileName(null);
      setFileText(null);
      setPreview(null);
      setFinalReport(null);
      setError(null);
    }
  }, [open]);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Always reset the input so re-picking the same file re-fires onChange
    // (e.g. retrying a file whose first preview failed).
    e.target.value = "";
    if (!file) return;
    setError(null);
    setPreview(null);
    setFinalReport(null);
    try {
      const text = await file.text();
      setFileName(file.name);
      setFileText(text);
      const report = await bootstrap.mutateAsync({
        document: text,
        dryRun: true,
      });
      setPreview(report);
    } catch (err) {
      setFileName(null);
      setFileText(null);
      setError(err as ApiError);
    }
  }

  async function handleApply() {
    if (!fileText) return;
    setError(null);
    try {
      const report = await bootstrap.mutateAsync({ document: fileText, dryRun: false });
      setFinalReport(report);
    } catch (err) {
      setError(err as ApiError);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import products</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            Upload a YAML or JSON catalog document. Products are created or
            updated by name-derived slug and wired to matching components.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="bootstrap-file">Catalog file</Label>
            <input
              id="bootstrap-file"
              type="file"
              accept=".yaml,.yml,.json"
              onChange={handleFile}
              className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-input file:bg-background file:px-3 file:py-1.5 file:text-sm"
            />
          </div>

          {preview && !finalReport && (
            <div className="space-y-2">
              <p className="text-sm font-medium">
                Preview — {fileName}
              </p>
              <ReportCounts report={preview} />
              <SkippedList report={preview} />
            </div>
          )}

          {finalReport && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Import complete</p>
              <ReportCounts report={finalReport} />
              <SkippedList report={finalReport} />
            </div>
          )}

          {error && (
            <div className="space-y-1" role="alert">
              <p className="text-sm text-destructive">
                {describeApiError(error, "Import failed")}
              </p>
              <ValidationIssueList error={error} />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            {finalReport ? "Close" : "Cancel"}
          </Button>
          {preview && !finalReport && (
            <Button onClick={handleApply} disabled={bootstrap.isPending}>
              {bootstrap.isPending ? "Importing…" : "Apply"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
