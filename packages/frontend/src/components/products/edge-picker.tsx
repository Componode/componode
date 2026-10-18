import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { useProducts } from "@/api/hooks/products";
import { useComponents } from "@/api/hooks/components";
import type { ApiError } from "@/api/client";

export type EdgeTarget =
  | { kind: "composes"; label: "Composes" }
  | { kind: "consumes-from"; label: "Consumes from" }
  | { kind: "depends-on"; label: "Depends on component" };

interface Props {
  open: boolean;
  onClose: () => void;
  target: EdgeTarget;
  /** The product the edge is anchored on (detail page product). */
  productId: string;
  onAdd: (body: Record<string, string>) => Promise<void>;
}

/**
 * Edge-adding picker (spec 005, US3): the option list is pre-filtered to the
 * legal counterpart types. Any product type may be a COMPOSES parent
 * (ADR-109); CONSUMES_FROM targets must still be PLATFORM. 409/422 errors
 * surface inline.
 */
export function EdgePicker({ open, onClose, target, productId, onAdd }: Props) {
  const { data: productsData } = useProducts({ includeRetired: true });
  const { data: componentsData } = useComponents({ pageSize: 100, sort: "name" });
  const [selected, setSelected] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  let options: { id: string; label: string }[] = [];
  let bodyKey = "childId";

  if (target.kind === "composes") {
    // Adding a COMPOSES child for this product — any type may be a parent or
    // child (ADR-109). Exclude self and retired products.
    options = (productsData?.products ?? [])
      .filter((p) => p.id !== productId && p.lifecycle !== "RETIRED")
      .map((p) => ({ id: p.id, label: p.name }));
    bodyKey = "childId";
  } else if (target.kind === "consumes-from") {
    options = (productsData?.products ?? [])
      .filter((p) => p.id !== productId && p.type === "PLATFORM" && p.lifecycle !== "RETIRED")
      .map((p) => ({ id: p.id, label: p.name }));
    bodyKey = "platformId";
  } else {
    options = (componentsData?.data ?? [])
      .filter((c) => c.lifecycle !== "RETIRED")
      .map((c) => ({ id: c.id, label: c.name }));
    bodyKey = "componentId";
  }

  async function handleAdd() {
    if (!selected) return;
    setPending(true);
    setSubmitError(null);
    try {
      await onAdd({ [bodyKey]: selected });
      setSelected("");
      onClose();
    } catch (err) {
      const apiErr = err as ApiError;
      setSubmitError(apiErr.message ?? "Failed to add edge");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{target.label}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="edge-target">Select target</Label>
            <select
              id="edge-target"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
            >
              <option value="">Choose…</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {submitError && (
            <p className="text-sm text-destructive" role="alert">
              {submitError}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={!selected || pending}>
            {pending ? "Adding…" : "Add"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
