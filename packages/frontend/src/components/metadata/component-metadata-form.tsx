import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LinksEditor } from "@/components/metadata/links-editor";
import { TagsInput } from "@/components/metadata/tags-input";
import { useUpdateComponent } from "@/api/hooks/components";
import { describeApiError, type ApiError } from "@/api/client";
import type { ComponentWithInstances, Link } from "@/api/types";

interface Props {
  open: boolean;
  onClose: () => void;
  component: ComponentWithInstances;
}

/**
 * Curated-metadata editor for a component (spec 017): links, tags, sunsetAt.
 * Importer-owned fields are not editable here.
 */
export function ComponentMetadataForm({ open, onClose, component }: Props) {
  const update = useUpdateComponent();
  const [links, setLinks] = useState<Link[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [sunsetAt, setSunsetAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setLinks(component.links ?? []);
      setTags(component.tags ?? []);
      setSunsetAt(component.sunsetAt ? component.sunsetAt.slice(0, 10) : "");
      setError(null);
    }
  }, [open, component]);

  async function handleSubmit() {
    setError(null);
    try {
      await update.mutateAsync({
        id: component.id,
        links: links.filter((l) => l.title.trim() || l.url.trim()),
        tags,
        sunsetAt: sunsetAt ? new Date(sunsetAt).toISOString() : null,
      });
      onClose();
    } catch (err) {
      setError(describeApiError(err as ApiError, "Save failed"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit {component.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label>Links</Label>
            <LinksEditor value={links} onChange={setLinks} />
          </div>
          <div className="space-y-1.5">
            <Label>Tags</Label>
            <TagsInput value={tags} onChange={setTags} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="c-sunset">Sunset date (optional)</Label>
            <Input
              id="c-sunset"
              type="date"
              value={sunsetAt}
              onChange={(e) => setSunsetAt(e.target.value)}
              className="w-48"
            />
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={update.isPending}>
            {update.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
