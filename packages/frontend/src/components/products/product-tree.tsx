import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, ChevronDown, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/states/status-badge";
import { CriticalityBadge } from "@/components/metadata/criticality-badge";
import { SunsetBadge } from "@/components/metadata/sunset-badge";
import { cn } from "@/lib/utils";
import type { DigitalProduct } from "@/api/types";

interface Edge {
  parentId: string;
  childId: string;
}

interface Props {
  products: DigitalProduct[];
  edges: Edge[];
  /** When true (search/filter active), render a flat list instead of a tree. */
  flattened?: boolean;
  onContextMenu?: (product: DigitalProduct) => void;
}

/**
 * Expandable COMPOSES tree (spec 005, US1). Roots are positional: any product
 * with no COMPOSES parent, regardless of type. A RETIRED parent hides its
 * subtree (children surface only via another visible parent). Expansion state
 * is in-memory only.
 */
export function ProductTree({ products, edges, flattened = false, onContextMenu }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { childrenOf, parentsOf, roots } = useMemo(() => {
    const childrenOf = new Map<string, string[]>();
    const parentsOf = new Map<string, string[]>();
    for (const e of edges) {
      childrenOf.set(e.parentId, [...(childrenOf.get(e.parentId) ?? []), e.childId]);
      parentsOf.set(e.childId, [...(parentsOf.get(e.childId) ?? []), e.parentId]);
    }
    const retiredIds = new Set(products.filter((p) => p.lifecycle === "RETIRED").map((p) => p.id));

    // A node is visible if any ancestry path avoids a retired parent.
    const hidden = new Set<string>();
    const hideBelow = (id: string) => {
      for (const c of childrenOf.get(id) ?? []) {
        const nonRetiredParents = (parentsOf.get(c) ?? []).filter((p) => !retiredIds.has(p));
        // If every parent path is retired, hide; root-level visibility unaffected.
        if (nonRetiredParents.length === 0) {
          hidden.add(c);
          hideBelow(c);
        }
      }
    };
    for (const r of retiredIds) hideBelow(r);

    const roots = products
      .filter((p) => (parentsOf.get(p.id) ?? []).length === 0 && !hidden.has(p.id))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { childrenOf, parentsOf, roots, hidden };
  }, [products, edges]);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const sortedChildren = (id: string) =>
    (childrenOf.get(id) ?? [])
      .map((c) => byId.get(c))
      .filter((p): p is DigitalProduct => !!p)
      .sort((a, b) => a.name.localeCompare(b.name));

  const toggle = (id: string) =>
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allExpandable = products.filter((p) => (childrenOf.get(p.id) ?? []).length > 0);

  function Row({ product, depth }: { product: DigitalProduct; depth: number }) {
    const kids = sortedChildren(product.id);
    const shared = (parentsOf.get(product.id) ?? []).length > 1;
    const isExpanded = expanded.has(product.id);
    return (
      <div>
        <div
          className={cn(
            "flex items-center gap-1.5 rounded-md py-1 pr-2 hover:bg-accent",
            product.lifecycle === "RETIRED" && "opacity-60",
          )}
          style={{ paddingLeft: `${depth * 1.25 + 0.5}rem` }}
          data-testid="tree-row"
          onContextMenu={
            onContextMenu
              ? (e) => {
                  e.preventDefault();
                  onContextMenu(product);
                }
              : undefined
          }
        >
          {kids.length > 0 ? (
            <button
              type="button"
              aria-label={isExpanded ? `Collapse ${product.name}` : `Expand ${product.name}`}
              aria-expanded={isExpanded}
              onClick={() => toggle(product.id)}
              className="rounded p-0.5 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
          ) : (
            <span className="w-5" aria-hidden="true" />
          )}
          <Link
            to={`/products/${product.slug}`}
            className="truncate font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
          >
            {product.name}
          </Link>
          {shared && (
            <Share2
              className="h-3.5 w-3.5 text-muted-foreground"
              aria-label="Shared — has multiple parents"
            />
          )}
          <span className="ml-auto flex items-center gap-2">
            <CriticalityBadge criticality={product.criticality} />
            <SunsetBadge sunsetAt={product.sunsetAt} lifecycle={product.lifecycle} />
            <StatusBadge status={product.type} className="font-normal" />
            <StatusBadge status={product.lifecycle} />
          </span>
        </div>
        {isExpanded &&
          kids.map((c) => <Row key={c.id} product={c} depth={depth + 1} />)}
      </div>
    );
  }

  if (flattened) {
    return (
      <div data-testid="product-tree" data-flattened="true">
        {products.map((p) => (
          <Row key={p.id} product={p} depth={0} />
        ))}
      </div>
    );
  }

  return (
    <div data-testid="product-tree">
      <div className="mb-2 flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setExpanded(new Set(allExpandable.map((p) => p.id)))}
        >
          Expand all
        </Button>
        <Button variant="outline" size="sm" onClick={() => setExpanded(new Set())}>
          Collapse all
        </Button>
      </div>
      {roots.map((p) => (
        <Row key={p.id} product={p} depth={0} />
      ))}
    </div>
  );
}
