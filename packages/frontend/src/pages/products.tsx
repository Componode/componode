import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Package, Plus, Upload } from "lucide-react";
import { useSession } from "@/api/hooks/auth";
import { useProducts } from "@/api/hooks/products";
import { ProductTree } from "@/components/products/product-tree";
import { ProductForm } from "@/components/products/product-form";
import { ImportProductsDialog } from "@/components/products/import-products-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { TableSkeleton } from "@/components/states/skeletons";
import { EmptyState } from "@/components/states/empty-state";
import { ErrorState } from "@/components/states/error-state";
import { Forbidden } from "@/components/states/forbidden";
import { PRODUCT_TYPES, PRODUCT_TYPE_META, CRITICALITIES, CRITICALITY_META } from "@componode/core";
import { FacetFilter } from "@/components/facet-filter";
import { roleAtLeast } from "@/lib/roles";
import { useState } from "react";
import type { ApiError } from "@/api/client";

/**
 * Tree-first products catalog (spec 005, US1). Filters persist in the URL;
 * search/type filters flatten the tree to a list (docs/ux.md §5).
 */
export function ProductsPage() {
  const { data: user } = useSession();
  const editor = roleAtLeast(user?.role);

  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const type = params.get("type") ?? "";
  const tag = params.get("tag") ?? "";
  const criticality = params.get("criticality") ?? "";
  const missing = params.get("missing") ?? "";
  const includeRetired = params.get("includeRetired") === "true";
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const { data, isPending, error, refetch } = useProducts({
    q: q || undefined,
    type: type || undefined,
    tag: tag || undefined,
    criticality: criticality || undefined,
    missing: missing || undefined,
    includeRetired,
  });

  const products = data?.products ?? [];
  const edges = data?.edges ?? [];
  const filtering = !!(q || type || tag || criticality || missing);
  const isForbidden = error ? (error as unknown as ApiError).code === "FORBIDDEN" : false;

  const setParam = (key: string, value: string | boolean) => {
    const next = new URLSearchParams(params);
    if (!value || value === "false") next.delete(key);
    else next.set(key, String(value));
    setParams(next, { replace: true });
  };

  const empty = useMemo(
    () => !isPending && !error && products.length === 0,
    [isPending, error, products.length],
  );

  return (
    <div className="bg-background p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold">Products</h1>
        {editor && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <Upload className="mr-2 h-4 w-4" /> Import products
            </Button>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="mr-2 h-4 w-4" /> New product
            </Button>
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          placeholder="Filter by name or slug…"
          value={q}
          onChange={(e) => setParam("q", e.target.value)}
          className="w-64"
          aria-label="Filter products"
        />
        <FacetFilter
          title="Type"
          mode="single"
          options={PRODUCT_TYPES.map((t) => ({
            value: t,
            label: PRODUCT_TYPE_META[t].label,
          }))}
          selected={type ? [type] : []}
          onChange={(v) => setParam("type", v[0] ?? "")}
        />
        <FacetFilter
          title="Criticality"
          mode="single"
          options={CRITICALITIES.map((c) => ({
            value: c,
            label: CRITICALITY_META[c].label,
          }))}
          selected={criticality ? [criticality] : []}
          onChange={(v) => setParam("criticality", v[0] ?? "")}
        />
        {/* Spec 023 US2: completeness-gap worklist (values OR'd server-side). */}
        <FacetFilter
          title="Completeness"
          options={[
            { value: "owner", label: "No owner" },
            { value: "dependencies", label: "No dependencies" },
            { value: "description", label: "No description" },
          ]}
          selected={missing ? missing.split(",") : []}
          onChange={(v) => setParam("missing", v.join(","))}
        />
        <Input
          placeholder="Tag…"
          value={tag}
          onChange={(e) => setParam("tag", e.target.value)}
          className="w-32"
          aria-label="Filter by tag"
        />
        <div className="flex items-center gap-2">
          <Switch
            id="show-retired"
            checked={includeRetired}
            onCheckedChange={(v) => setParam("includeRetired", v)}
          />
          <Label htmlFor="show-retired">Show retired</Label>
        </div>
      </div>

      {isPending && products.length === 0 && <TableSkeleton />}
      {!isPending && isForbidden && <Forbidden />}
      {!isPending && !isForbidden && error && (
        <ErrorState error={error} onRetry={() => refetch()} />
      )}
      {empty && (
        <>
          <EmptyState
            icon={Package}
            title={filtering ? "No products match" : "No products yet"}
            description={
              filtering
                ? "Try a different filter or search."
                : "Create a product to start modeling your portfolio — or import an existing catalog document."
            }
            action={
              !filtering && editor
                ? { label: "New product", onClick: () => setCreateOpen(true) }
                : undefined
            }
          />
          {!filtering && editor && (
            <div className="-mt-8 flex justify-center">
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="mr-2 h-4 w-4" /> Import products
              </Button>
            </div>
          )}
        </>
      )}
      {!error && products.length > 0 && (
        <ProductTree products={products} edges={edges} flattened={filtering} />
      )}

      <ProductForm open={createOpen} onClose={() => setCreateOpen(false)} />
      <ImportProductsDialog open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
