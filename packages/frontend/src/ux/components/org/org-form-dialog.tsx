import { PlusIcon } from "lucide-react";
import * as React from "react";
import { Button } from "@/ux/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/ux/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/ux/components/ui/field";
import { Input } from "@/ux/components/ui/input";
import { Textarea } from "@/ux/components/ui/textarea";

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function deriveSlug(name: string) {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface OrgFormDialogProps {
  noun: "team" | "line of business";
  /** Set for edit; absent for create. */
  initial?: { id: string; name: string; slug: string; description?: string | null };
  onSubmit: (vars: { id?: string; name: string; slug: string; description?: string | null }) => void;
  pending?: boolean;
  trigger?: React.ReactNode;
}

/** Create/edit dialog for teams and lines of business (POST/PATCH /teams|/lobs). */
export function OrgFormDialog({ noun, initial, onSubmit, pending, trigger }: OrgFormDialogProps) {
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState(initial?.name ?? "");
  const [slug, setSlug] = React.useState(initial?.slug ?? "");
  const [slugTouched, setSlugTouched] = React.useState(Boolean(initial));
  const [description, setDescription] = React.useState(initial?.description ?? "");
  const [error, setError] = React.useState<string | null>(null);
  const editing = Boolean(initial);

  React.useEffect(() => {
    if (open && initial) {
      setName(initial.name);
      setSlug(initial.slug);
      setDescription(initial.description ?? "");
      setSlugTouched(true);
      setError(null);
    }
  }, [open, initial]);

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim()) return setError("Name is required.");
    if (!SLUG_RE.test(slug)) return setError("Slug must be lowercase kebab-case (a-z, 0-9, -).");
    setError(null);
    onSubmit({ id: initial?.id, name: name.trim(), slug, description: description.trim() || null });
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button>
            <PlusIcon data-icon="inline-start" />
            New {noun}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form className="flex flex-col gap-6" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{editing ? `Edit ${noun}` : `New ${noun}`}</DialogTitle>
            <DialogDescription>
              {noun === "team"
                ? "Teams own products and components — ownership drives notifications and incident routing."
                : "Every product rolls up to exactly one line of business."}
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="org-name">Name</FieldLabel>
              <Input
                id="org-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  if (!slugTouched) setSlug(deriveSlug(e.target.value));
                }}
                required
                autoComplete="off"
              />
            </Field>
            <Field data-invalid={error?.startsWith("Slug") ? true : undefined}>
              <FieldLabel htmlFor="org-slug">Slug</FieldLabel>
              <Input
                id="org-slug"
                value={slug}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(e.target.value);
                }}
                className="font-mono"
                required
                autoComplete="off"
              />
              <FieldDescription>Stable identifier used in URLs.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="org-desc">Description</FieldLabel>
              <Textarea id="org-desc" value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
            </Field>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </FieldGroup>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" type="button">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {editing ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
