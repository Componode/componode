import * as React from "react";
import { FileUpIcon, XIcon } from "lucide-react";
import { Button } from "@/ux/components/ui/button";
import { Textarea } from "@/ux/components/ui/textarea";
import { cn } from "@/ux/lib/utils";

export interface SecretValueFieldProps {
  id: string;
  value: string;
  /**
   * `fileName` is set when the value came from an uploaded file and cleared
   * (undefined) on manual edits — parents use it only for display.
   */
  onChange: (value: string, fileName?: string) => void;
  /** Name of the file the current value was loaded from, if any. */
  fileName?: string;
  disabled?: boolean;
  /** File-picker filter (e.g. ".pem,.key"); omit to allow any file. */
  accept?: string;
  rows?: number;
  placeholder?: string;
  className?: string;
  "aria-invalid"?: boolean;
}

/**
 * Multi-line secret value entry: paste into the textarea (newlines are
 * preserved — PEM survives) or load the value from a file read entirely
 * client-side. The content stays in the parent's secret state and follows
 * the same write-only API path as typed values; nothing is uploaded as a
 * file.
 */
export function SecretValueField({
  id,
  value,
  onChange,
  fileName,
  disabled,
  accept,
  rows = 4,
  placeholder,
  className,
  "aria-invalid": ariaInvalid,
}: SecretValueFieldProps) {
  const fileRef = React.useRef<HTMLInputElement>(null);
  const [reading, setReading] = React.useState(false);
  const [fileError, setFileError] = React.useState<string | null>(null);

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset so picking the same file twice still fires change.
    e.target.value = "";
    if (!file) return;
    setFileError(null);
    setReading(true);
    try {
      const text = await file.text();
      if (!text.trim()) {
        setFileError("The file is empty.");
        return;
      }
      onChange(text, file.name);
    } catch {
      setFileError("Could not read the file.");
    } finally {
      setReading(false);
    }
  }

  return (
    <div className={cn("grid gap-2", className)}>
      <div className="flex items-center gap-2">
        <input
          ref={fileRef}
          id={`${id}-file`}
          type="file"
          accept={accept}
          disabled={disabled}
          onChange={(e) => void onPick(e)}
          className="hidden"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || reading}
          onClick={() => fileRef.current?.click()}
        >
          <FileUpIcon data-icon="inline-start" />
          {reading ? "Reading…" : fileName ? "Replace file" : "Upload file"}
        </Button>
        {fileName && (
          <span className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
            <span className="truncate font-mono text-xs">{fileName}</span>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6 shrink-0"
              disabled={disabled}
              onClick={() => onChange("")}
              aria-label="Clear loaded file"
            >
              <XIcon />
            </Button>
          </span>
        )}
      </div>
      <Textarea
        id={id}
        value={value}
        rows={rows}
        disabled={disabled}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        onChange={(e) => {
          setFileError(null);
          onChange(e.target.value);
        }}
        aria-invalid={ariaInvalid}
        placeholder={placeholder}
        className="font-mono text-xs"
      />
      {fileError && <p className="text-sm text-destructive">{fileError}</p>}
    </div>
  );
}
