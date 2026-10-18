import { useState } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const MAX_TAGS = 20;
const TAG_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,31}$/;

/** Write-time normalization shared with the server schema (spec 017, US2). */
export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidTag(tag: string): boolean {
  return TAG_PATTERN.test(tag);
}

/** Read-only chip renderer for detail pages and list rows. */
export function TagChips({ tags, className }: { tags: string[]; className?: string }) {
  if (tags.length === 0) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1", className)}>
      {tags.map((t) => (
        <Badge key={t} variant="outline" className="bg-muted text-muted-foreground font-normal">
          {t}
        </Badge>
      ))}
    </span>
  );
}

interface Props {
  value: string[];
  onChange: (tags: string[]) => void;
}

/**
 * Chips + free-text tag editor (spec 017, US2). Enter or comma commits a tag;
 * values are lowercased, trimmed, deduped, and validated against the tag
 * charset before being added.
 */
export function TagsInput({ value, onChange }: Props) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  function commit() {
    const tag = normalizeTag(draft);
    setDraft("");
    setError(null);
    if (!tag) return;
    if (!isValidTag(tag)) {
      setError("Tags must start with a letter or digit and use a-z, 0-9, . _ : -");
      return;
    }
    if (value.includes(tag)) return; // dedupe
    if (value.length >= MAX_TAGS) {
      setError(`Maximum ${MAX_TAGS} tags`);
      return;
    }
    onChange([...value, tag]);
  }

  return (
    <div className="space-y-2" data-testid="tags-input">
      <div className="flex flex-wrap items-center gap-1">
        {value.map((t) => (
          <Badge key={t} variant="outline" className="gap-1 font-normal">
            {t}
            <button
              type="button"
              aria-label={`Remove tag ${t}`}
              className="rounded-sm hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => onChange(value.filter((v) => v !== t))}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>
      <Input
        aria-label="Add tag"
        placeholder="Add tag… (Enter to add)"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && !draft && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={commit}
        className="h-8 max-w-60"
      />
      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
