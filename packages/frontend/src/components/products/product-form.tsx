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
import { OwnerPickers } from "@/components/products/owner-picker";
import { LinksEditor } from "@/components/metadata/links-editor";
import { TagsInput } from "@/components/metadata/tags-input";
import {
  useCreateProduct,
  useUpdateProduct,
} from "@/api/hooks/products";
import { PRODUCT_TYPES, PRODUCT_TYPE_META, CRITICALITIES, CRITICALITY_META } from "@componode/core";
import type { DigitalProduct, Link } from "@/api/types";
import { describeApiError, type ApiError } from "@/api/client";

interface Props {
  open: boolean;
  onClose: () => void;
  product?: DigitalProduct; // present = edit mode
}

/** Create/edit product dialog (spec 005, US3/US4). */
export function ProductForm({ open, onClose, product }: Props) {
  const create = useCreateProduct();
  const update = useUpdateProduct();
  const [form, setForm] = useState({
    name: "",
    slug: "",
    type: "BUSINESS_CAPABILITY",
    description: "",
    lifecycle: "ACTIVE",
    lobOwnerId: "",
    teamOwnerId: "",
    criticality: "",
    sunsetAt: "",
  });
  const [links, setLinks] = useState<Link[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm({
        name: product?.name ?? "",
        slug: product?.slug ?? "",
        type: product?.type ?? "BUSINESS_CAPABILITY",
        description: product?.description ?? "",
        lifecycle: product?.lifecycle ?? "ACTIVE",
        lobOwnerId: product?.lobOwnerId ?? "",
        teamOwnerId: product?.teamOwnerId ?? "",
        criticality: product?.criticality ?? "",
        sunsetAt: product?.sunsetAt ? product.sunsetAt.slice(0, 10) : "",
      });
      setLinks(product?.links ?? []);
      setTags(product?.tags ?? []);
      setError(null);
    }
  }, [open, product]);

  const pending = create.isPending || update.isPending;

  async function handleSubmit() {
    setError(null);
    try {
      const linksToSave = links.filter((l) => l.title.trim() || l.url.trim());
      const sunsetAt = form.sunsetAt ? new Date(form.sunsetAt).toISOString() : null;
      if (product) {
        await update.mutateAsync({
          id: product.id,
          name: form.name,
          slug: form.slug || undefined,
          type: form.type,
          description: form.description || null,
          lifecycle: form.lifecycle,
          lobOwnerId: form.lobOwnerId || null,
          teamOwnerId: form.teamOwnerId || null,
          links: linksToSave,
          tags,
          criticality: form.criticality || null,
          sunsetAt,
        });
      } else {
        await create.mutateAsync({
          name: form.name,
          slug: form.slug || undefined,
          type: form.type,
          description: form.description || undefined,
          lobOwnerId: form.lobOwnerId || undefined,
          teamOwnerId: form.teamOwnerId || undefined,
          links: linksToSave,
          tags,
          criticality: form.criticality || null,
          sunsetAt,
        });
      }
      onClose();
    } catch (err) {
      setError(describeApiError(err as ApiError, "Save failed"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{product ? "Edit product" : "New product"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="p-name">Name</Label>
            <Input
              id="p-name"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-slug">Slug (auto-derived if blank)</Label>
            <Input
              id="p-slug"
              value={form.slug}
              onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-type">Type</Label>
            <select
              id="p-type"
              value={form.type}
              onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              {PRODUCT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {PRODUCT_TYPE_META[t].label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-desc">Description</Label>
            <Input
              id="p-desc"
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
            />
          </div>
          {product && (
            <div className="space-y-1.5">
              <Label htmlFor="p-lifecycle">Lifecycle</Label>
              <select
                id="p-lifecycle"
                value={form.lifecycle}
                onChange={(e) =>
                  setForm((f) => ({ ...f, lifecycle: e.target.value }))
                }
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="ACTIVE">ACTIVE</option>
                <option value="RETIRED">RETIRED</option>
              </select>
            </div>
          )}
          <OwnerPickers
            lobOwnerId={form.lobOwnerId}
            teamOwnerId={form.teamOwnerId}
            onLobChange={(v) => setForm((f) => ({ ...f, lobOwnerId: v }))}
            onTeamChange={(v) => setForm((f) => ({ ...f, teamOwnerId: v }))}
          />
          <div className="space-y-1.5">
            <Label htmlFor="p-criticality">Criticality (optional)</Label>
            <select
              id="p-criticality"
              value={form.criticality}
              onChange={(e) => setForm((f) => ({ ...f, criticality: e.target.value }))}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">None</option>
              {CRITICALITIES.map((c) => (
                <option key={c} value={c}>
                  {CRITICALITY_META[c].label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="p-sunset">Sunset date (optional)</Label>
            <Input
              id="p-sunset"
              type="date"
              value={form.sunsetAt}
              onChange={(e) => setForm((f) => ({ ...f, sunsetAt: e.target.value }))}
              className="w-48"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Links</Label>
            <LinksEditor value={links} onChange={setLinks} idPrefix="p-link" />
          </div>
          <div className="space-y-1.5">
            <Label>Tags</Label>
            <TagsInput value={tags} onChange={setTags} />
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
          <Button onClick={handleSubmit} disabled={!form.name || pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
