import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Link } from "@/api/types";

const MAX_LINKS = 20;

interface Props {
  value: Link[];
  onChange: (links: Link[]) => void;
  /** Per-field label prefix used for accessible input labels. */
  idPrefix?: string;
}

/**
 * Ordered title+URL row editor for curated links (spec 017, US1). Capped at
 * MAX_LINKS; server-side schema remains authoritative for URL validation.
 */
export function LinksEditor({ value, onChange, idPrefix = "link" }: Props) {
  function update(i: number, patch: Partial<Link>) {
    onChange(value.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  function remove(i: number) {
    onChange(value.filter((_, j) => j !== i));
  }

  function add() {
    if (value.length >= MAX_LINKS) return;
    onChange([...value, { title: "", url: "" }]);
  }

  return (
    <div className="space-y-2" data-testid="links-editor">
      {value.map((link, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            aria-label={`${idPrefix}-title-${i}`}
            placeholder="Title"
            value={link.title}
            maxLength={80}
            onChange={(e) => update(i, { title: e.target.value })}
            className="w-2/5"
          />
          <Input
            aria-label={`${idPrefix}-url-${i}`}
            placeholder="https://…"
            value={link.url}
            onChange={(e) => update(i, { url: e.target.value })}
            className="flex-1 font-mono text-xs"
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Remove link ${i + 1}`}
            onClick={() => remove(i)}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={add}
          disabled={value.length >= MAX_LINKS}
        >
          <Plus className="mr-1 h-3.5 w-3.5" /> Add link
        </Button>
        {value.length >= MAX_LINKS && (
          <span className="text-xs text-muted-foreground">Maximum {MAX_LINKS} links</span>
        )}
      </div>
    </div>
  );
}

/** Shared label used by both product and component forms. */
export function LinksEditorField(props: Props) {
  return (
    <div className="space-y-1.5">
      <Label>Links</Label>
      <LinksEditor {...props} />
    </div>
  );
}
