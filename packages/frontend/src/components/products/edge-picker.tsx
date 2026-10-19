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
import { useAllComponents } from "@/api/hooks/components";
import { useComponentGroups } from "@/api/hooks/component-groups";
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
  /** Component ids the product already depends on (direct or via group) — shown disabled. */
  existingComponentIds?: string[];
  onAdd: (body: Record<string, string | string[]>) => Promise<void>;
}

/**
 * Edge-adding picker (spec 005, US3): the option list is pre-filtered to the
 * legal counterpart types. Any product type may be a COMPOSES parent
 * (ADR-109); CONSUMES_FROM targets must still be PLATFORM. DEPENDS_ON is a
 * multi-select (spec 021 US3): checked components submit one `componentIds[]`
 * request; a selected group submits `componentGroupId` instead — never both.
 * 409/422 errors surface inline.
 */
export function EdgePicker({ open, onClose, target, productId, existingComponentIds, onAdd }: Props) {
  const { data: productsData } = useProducts({ includeRetired: true });
  const { data: componentsData } = useAllComponents({ sort: "name" });
  const { data: groupsData } = useComponentGroups();
  const [selected, setSelected] = useState("");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [selectedGroup, setSelectedGroup] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  let options: { id: string; label: string; bodyKey: string }[] = [];

  if (target.kind === "composes") {
    // Adding a COMPOSES child for this product — any type may be a parent or
    // child (ADR-109). Exclude self and retired products.
    options = (productsData?.products ?? [])
      .filter((p) => p.id !== productId && p.lifecycle !== "RETIRED")
      .map((p) => ({ id: p.id, label: p.name, bodyKey: "childId" }));
  } else if (target.kind === "consumes-from") {
    options = (productsData?.products ?? [])
      .filter((p) => p.id !== productId && p.type === "PLATFORM" && p.lifecycle !== "RETIRED")
      .map((p) => ({ id: p.id, label: p.name, bodyKey: "platformId" }));
  }

  // ADR-110 + spec 021 US3: depends-on mode is a mixed picker — components as
  // checkboxes (bulk submit via componentIds[]), groups as single-select.
  const dependsOn = target.kind === "depends-on";
  const alreadyWired = new Set(existingComponentIds ?? []);
  const components = dependsOn
    ? (componentsData ?? []).filter((c) => c.lifecycle !== "RETIRED")
    : [];
  const groups = dependsOn
    ? (groupsData?.groups ?? []).filter((g) => g.lifecycle !== "RETIRED")
    : [];

  function toggleComponent(id: string) {
    if (alreadyWired.has(id)) return;
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setSelectedGroup(""); // checking a component deselects the group
  }

  async function handleAdd() {
    let body: Record<string, string | string[]> | null = null;
    if (dependsOn) {
      if (checked.size > 0) body = { componentIds: [...checked] };
      else if (selectedGroup) body = { componentGroupId: selectedGroup };
    } else {
      const option = options.find((o) => o.id === selected);
      if (option) body = { [option.bodyKey]: option.id };
    }
    if (!body) return;
    setPending(true);
    setSubmitError(null);
    try {
      await onAdd(body);
      setSelected("");
      setChecked(new Set());
      setSelectedGroup("");
      onClose();
    } catch (err) {
      const apiErr = err as ApiError;
      setSubmitError(apiErr.message ?? "Failed to add edge");
    } finally {
      setPending(false);
    }
  }

  const canSubmit = dependsOn
    ? checked.size > 0 || !!selectedGroup
    : !!selected;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{target.label}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          {dependsOn ? (
            <>
              <div className="space-y-1.5">
                <Label>Components</Label>
                {components.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No active components found.
                  </p>
                ) : (
                  <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-input p-2">
                    {components.map((c) => (
                      <li key={c.id} className="flex items-center gap-2 text-sm">
                        <input
                          id={`dep-${c.id}`}
                          type="checkbox"
                          className="h-4 w-4"
                          checked={checked.has(c.id)}
                          disabled={alreadyWired.has(c.id)}
                          onChange={() => toggleComponent(c.id)}
                        />
                        <label
                          htmlFor={`dep-${c.id}`}
                          className={
                            alreadyWired.has(c.id)
                              ? "text-muted-foreground line-through"
                              : undefined
                          }
                        >
                          {c.name}
                          {alreadyWired.has(c.id) && (
                            <span className="ml-2 text-xs text-muted-foreground">
                              already wired
                            </span>
                          )}
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {groups.length > 0 && (
                <div className="space-y-1.5">
                  <Label>Component groups</Label>
                  <ul className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-input p-2">
                    {groups.map((g) => (
                      <li key={g.id} className="flex items-center gap-2 text-sm">
                        <input
                          id={`grp-${g.id}`}
                          type="radio"
                          name="depends-on-group"
                          className="h-4 w-4"
                          checked={selectedGroup === g.id}
                          onChange={() => {
                            setSelectedGroup(g.id);
                            setChecked(new Set()); // exactly-one-of: clears components
                          }}
                        />
                        <label htmlFor={`grp-${g.id}`}>
                          {g.name} (group · {g.memberCount ?? 0})
                        </label>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground">
                    Selecting a group replaces the component selection — an edge
                    targets either components or one group.
                  </p>
                </div>
              )}
            </>
          ) : (
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
          )}
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
          <Button onClick={handleAdd} disabled={!canSubmit || pending}>
            {pending ? "Adding…" : "Add"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
