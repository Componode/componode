import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
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
import {
  useComponentDependents,
  usePromoteComponent,
} from "@/api/hooks/components";
import { describeApiError, type ApiError } from "@/api/client";

interface Props {
  open: boolean;
  onClose: () => void;
  component: { id: string; name: string };
}

/**
 * ADR-017 guided promotion (spec 020): creates a PLATFORM product from the
 * component and rewrites the checked consumers' direct edges to
 * CONSUMES_FROM. Every consumer starts checked — unchecking one keeps its
 * DEPENDS_ON edge untouched.
 */
export function PromoteToPlatformDialog({ open, onClose, component }: Props) {
  const navigate = useNavigate();
  const promote = usePromoteComponent();
  const { data: dependents, isPending } = useComponentDependents(
    open ? component.id : null,
  );

  const [form, setForm] = useState({
    name: "",
    slug: "",
    description: "",
    lobOwnerId: "",
    teamOwnerId: "",
  });
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm({
        name: component.name,
        slug: "",
        description: "",
        lobOwnerId: "",
        teamOwnerId: "",
      });
      setUnchecked(new Set());
      setError(null);
    }
  }, [open, component]);

  const consumers = dependents ?? [];
  const checkedIds = consumers
    .filter((d) => !unchecked.has(d.id))
    .map((d) => d.id);

  function toggle(id: string) {
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit() {
    setError(null);
    try {
      const { product } = await promote.mutateAsync({
        id: component.id,
        input: {
          name: form.name,
          slug: form.slug || undefined,
          description: form.description || undefined,
          lobOwnerId: form.lobOwnerId || undefined,
          teamOwnerId: form.teamOwnerId || undefined,
          consumerIds: checkedIds,
        },
      });
      onClose();
      navigate(`/products/${product.slug}`);
    } catch (err) {
      setError(describeApiError(err as ApiError, "Promotion failed"));
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Promote to platform product</DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="promote-name">Name</Label>
            <Input
              id="promote-name"
              value={form.name}
              onChange={(e) =>
                setForm((f) => ({ ...f, name: e.target.value }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="promote-slug">Slug (auto-derived if blank)</Label>
            <Input
              id="promote-slug"
              value={form.slug}
              onChange={(e) =>
                setForm((f) => ({ ...f, slug: e.target.value }))
              }
              className="font-mono"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="promote-desc">Description</Label>
            <Input
              id="promote-desc"
              value={form.description}
              onChange={(e) =>
                setForm((f) => ({ ...f, description: e.target.value }))
              }
            />
          </div>
          <OwnerPickers
            lobOwnerId={form.lobOwnerId}
            teamOwnerId={form.teamOwnerId}
            onLobChange={(v) => setForm((f) => ({ ...f, lobOwnerId: v }))}
            onTeamChange={(v) => setForm((f) => ({ ...f, teamOwnerId: v }))}
          />
          <div className="space-y-1.5">
            <Label>Consumers to reroute</Label>
            {isPending ? (
              <p className="text-sm text-muted-foreground">
                Loading dependents…
              </p>
            ) : consumers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No products depend on this component — a consumerless platform
                product will be created.
              </p>
            ) : (
              <ul className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-input p-2">
                {consumers.map((d) => (
                  <li key={d.id} className="flex items-center gap-2 text-sm">
                    <input
                      id={`consumer-${d.id}`}
                      type="checkbox"
                      checked={!unchecked.has(d.id)}
                      onChange={() => toggle(d.id)}
                      className="h-4 w-4"
                    />
                    <label htmlFor={`consumer-${d.id}`} className="min-w-0">
                      <span className="font-medium">{d.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {d.type.toLowerCase().replaceAll("_", " ")}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {consumers.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Unchecked products keep their direct dependency on the
                component.
              </p>
            )}
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
          <Button
            onClick={handleSubmit}
            disabled={!form.name || promote.isPending}
          >
            {promote.isPending ? "Promoting…" : "Promote"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
