import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, Pencil, Trash2, Plus, Archive, ArchiveRestore } from "lucide-react";
import { useSession } from "@/api/hooks/auth";
import {
  useProduct,
  useUpdateProduct,
  useDeleteProduct,
  useAddEdge,
  useRemoveEdge,
} from "@/api/hooks/products";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { PageSkeleton } from "@/components/states/skeletons";
import { ErrorState } from "@/components/states/error-state";
import { Forbidden } from "@/components/states/forbidden";
import { StatusBadge } from "@/components/states/status-badge";
import { LinksCard } from "@/components/metadata/links-card";
import { TagChips } from "@/components/metadata/tags-input";
import { CriticalityBadge } from "@/components/metadata/criticality-badge";
import { SunsetBadge } from "@/components/metadata/sunset-badge";
import { relativeTime, absoluteTime, MONO_CLASS } from "@/lib/format";
import { useSetCrumbLabel } from "@/components/layout/crumb-context";
import { ProductForm } from "@/components/products/product-form";
import { HealthBadge } from "@/components/products/health-badge";
import { EdgePicker, type EdgeTarget } from "@/components/products/edge-picker";
import { EntityHistory } from "@/components/entity-history";
import { cn } from "@/lib/utils";
import type { ApiError } from "@/api/client";
import type { ProductRef, ComponentDepRef, InstanceDepRef } from "@/api/types";
import type { DepSource } from "@componode/core";

const ROLE_LEVEL: Record<string, number> = { VIEWER: 0, EDITOR: 1, ADMIN: 2 };
type Tab = "overview" | "composition" | "components" | "instances";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "composition", label: "Composition" },
  { id: "components", label: "Components" },
  { id: "instances", label: "Instances" },
];

/** Standard detail-page anatomy per docs/ux.md §4 — spec 005, US2/US3. */
export function ProductDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { data: user } = useSession();
  const editor = (ROLE_LEVEL[user?.role ?? "VIEWER"] ?? 0) >= 1;

  const { data, isPending, error, refetch } = useProduct(slug);
  const product = data?.product;
  useSetCrumbLabel(product?.slug ?? null);

  const [tab, setTab] = useState<Tab>("overview");
  const [editOpen, setEditOpen] = useState(false);
  const [edgePicker, setEdgePicker] = useState<EdgeTarget | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const update = useUpdateProduct();
  const del = useDeleteProduct();
  const addEdge = useAddEdge();
  const removeEdge = useRemoveEdge();

  const isForbidden = error ? (error as unknown as ApiError).code === "FORBIDDEN" : false;

  if (isPending && !product) return <PageSkeleton />;
  if (isForbidden)
    return (
      <div className="bg-background p-6">
        <Forbidden />
      </div>
    );
  if (error || !data || !product)
    return (
      <div className="bg-background p-6">
        <ErrorState
          title="Product not found"
          error={error ?? undefined}
          onRetry={() => refetch()}
        />
      </div>
    );

  async function handleDelete() {
    try {
      setConfirmDelete(false);
      await del.mutateAsync(product!.id);
      navigate("/products");
    } catch (err) {
      const e = err as unknown as ApiError;
      const counts = (e.details as { counts?: Record<string, number> } | undefined)?.counts;
      const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;
      setActionError(
        `Cannot delete: product still has ${total} edge(s). Retire it or remove the edges first.`,
      );
    }
  }

  function edgeSection(
    title: string,
    rows: ProductRef[],
    kind: "composes" | "consumes-from" | "composed-by" | "consumed-by",
  ) {
    return (
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">{title}</CardTitle>
          {editor && (kind === "composes" || kind === "consumes-from") && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setEdgePicker(
                  kind === "composes"
                    ? { kind, label: "Composes" }
                    : { kind, label: "Consumes from" },
                )
              }
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Add
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">None.</p>
          ) : (
            <ul className="space-y-1">
              {rows.map((r) => (
                <li key={r.id} className="flex items-center gap-2 text-sm">
                  <Link
                    to={`/products/${r.slug}`}
                    className="font-medium hover:underline"
                  >
                    {r.name}
                  </Link>
                  <StatusBadge status={r.type} className="font-normal" />
                  <StatusBadge status={r.lifecycle} />
                  {editor && (kind === "composes" || kind === "consumes-from") && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        removeEdge.mutate({
                          id: product!.id,
                          kind,
                          otherId: r.id,
                        })
                      }
                    >
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    );
  }

  /** Via cell: render a dep row's sources[] (ADR-110 §2). */
  function depSources(sources: DepSource[]) {
    if (sources.length === 0) return "—";
    return sources.map((s, i) => (
      <span key={i}>
        {i > 0 && ", "}
        {s.kind === "DIRECT" ? (
          "direct"
        ) : s.kind === "GROUP" ? (
          <Link to="/component-groups" className="text-foreground hover:underline">
            group: {s.group.name}
          </Link>
        ) : (
          <Link
            to={`/products/${s.product.slug}`}
            className="text-foreground hover:underline"
          >
            {s.product.name}
          </Link>
        )}
      </span>
    ));
  }

  function componentTable(rows: ComponentDepRef[]) {
    return rows.length === 0 ? (
      <p className="text-sm text-muted-foreground">None.</p>
    ) : (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Category</TableHead>
            <TableHead>Lifecycle</TableHead>
            <TableHead>Via</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((c) => (
            <TableRow key={c.id}>
              <TableCell>
                <Link
                  to={`/components/${c.id}`}
                  className="font-medium hover:underline"
                >
                  {c.name}
                </Link>
              </TableCell>
              <TableCell>{c.category}</TableCell>
              <TableCell>
                <StatusBadge status={c.lifecycle} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {depSources(c.sources)}
              </TableCell>
              <TableCell className="w-10">
                {editor && c.sources.some((s) => s.kind === "DIRECT") && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove dependency ${c.name}`}
                    onClick={() =>
                      removeEdge.mutate({
                        id: product!.id,
                        kind: "depends-on",
                        otherId: c.id,
                        targetKind: "component",
                      })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  // Spec 005 US2/AC4: instances grouped by environment.
  function instanceTable(rows: InstanceDepRef[]) {
    if (rows.length === 0)
      return <p className="text-sm text-muted-foreground">None.</p>;
    const byEnv = new Map<string, InstanceDepRef[]>();
    for (const i of rows) {
      const env = i.environment ?? "UNSPECIFIED";
      if (!byEnv.has(env)) byEnv.set(env, []);
      byEnv.get(env)!.push(i);
    }
    return [...byEnv.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([env, items]) => (
        <div key={env} className="mb-4">
          <h3 className="mb-1.5 text-sm font-semibold text-muted-foreground">
            {env}
          </h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Component</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Region</TableHead>
                <TableHead>Via</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="font-medium">{i.componentName}</TableCell>
                  <TableCell>
                    <StatusBadge status={i.status} />
                  </TableCell>
                  <TableCell>{i.region ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {i.via ? i.via.name : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ));
  }

  return (
    <div className="bg-background p-6">
      <div className="mb-4">
        <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2">
          <Link to="/products">
            <ArrowLeft className="mr-1 h-4 w-4" /> Products
          </Link>
        </Button>
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">{product.name}</h1>
              <StatusBadge
                status={product.type}
                className="font-normal"
              />
              <StatusBadge status={product.lifecycle} />
              <CriticalityBadge criticality={product.criticality} />
              <SunsetBadge sunsetAt={product.sunsetAt} lifecycle={product.lifecycle} />
              <HealthBadge
                status={data.health?.status ?? null}
                perEnv={data.health?.perEnv}
              />
            </div>
            <p className={cn("text-sm text-muted-foreground", MONO_CLASS)}>
              {product.slug}
            </p>
            <TagChips tags={product.tags ?? []} className="mt-1" />
          </div>
          {editor && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                <Pencil className="mr-1 h-4 w-4" /> Edit
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  update.mutate({
                    id: product!.id,
                    lifecycle: product.lifecycle === "RETIRED" ? "ACTIVE" : "RETIRED",
                  })
                }
              >
                {product.lifecycle === "RETIRED" ? (
                  <>
                    <ArchiveRestore className="mr-1 h-4 w-4" /> Un-retire
                  </>
                ) : (
                  <>
                    <Archive className="mr-1 h-4 w-4" /> Retire
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDelete(true)}
                disabled={del.isPending}
              >
                <Trash2 className="mr-1 h-4 w-4 text-destructive" /> Delete
              </Button>
            </div>
          )}
        </div>
        {actionError && (
          <p className="mt-2 text-sm text-destructive" role="alert">
            {actionError}
          </p>
        )}
      </div>

      <div className="mb-4 flex gap-1 border-b" role="tablist" aria-label="Product sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "border-b-2 px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab === t.id
                ? "border-primary font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p>{product.description || "No description."}</p>
              <p>
                <span className="text-muted-foreground">LOB owner: </span>
                {product.lobOwnerName ?? "Unassigned"}
              </p>
              <p>
                <span className="text-muted-foreground">Team owner: </span>
                {product.teamOwnerName ?? "Unassigned"}
              </p>
              <div className="flex items-start gap-2">
                <span className="text-muted-foreground">Health: </span>
                {data.health ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={data.health.status} />
                    {Object.entries(data.health.perEnv).map(([env, s]) => (
                      <span
                        key={env}
                        className="text-muted-foreground inline-flex items-center gap-1"
                      >
                        {env}
                        <StatusBadge status={s} className="font-normal" />
                      </span>
                    ))}
                    <span className="text-muted-foreground">
                      ({data.health.sourceCount} source
                      {data.health.sourceCount === 1 ? "" : "s"})
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </div>
              <p title={absoluteTime(product.updatedAt)}>
                <span className="text-muted-foreground">Updated: </span>
                {relativeTime(product.updatedAt)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Counts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>Composed by: {data.counts.composedBy}</p>
              <p>Composes: {data.counts.composes}</p>
              <p>Components: {data.counts.components}</p>
              <p>Instances: {data.counts.instances}</p>
            </CardContent>
          </Card>
          <LinksCard links={product.links ?? []} />
        </div>
      )}

      {tab === "composition" && (
        <div className="grid gap-4 md:grid-cols-2">
          {edgeSection("Composed by", data.composedBy, "composed-by")}
          {edgeSection("Composes", data.composes, "composes")}
          {edgeSection("Consumes from", data.consumesFrom, "consumes-from")}
          {product.type === "PLATFORM" &&
            edgeSection("Consumed by", data.consumedBy, "consumed-by")}
        </div>
      )}

      {tab === "components" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Declared</h2>
            {editor && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setEdgePicker({ kind: "depends-on", label: "Depends on component" })
                }
              >
                <Plus className="mr-1 h-3.5 w-3.5" /> Add dependency
              </Button>
            )}
          </div>
          {componentTable(data.components.declared)}
          {data.dependsOnGroups.length > 0 && (
            <div>
              <h2 className="mb-2 text-lg font-semibold">Group dependencies</h2>
              <ul className="space-y-1">
                {data.dependsOnGroups.map((g) => (
                  <li key={g.id} className="flex items-center gap-2 text-sm">
                    <Link
                      to="/component-groups"
                      className="font-medium hover:underline"
                    >
                      {g.name}
                    </Link>
                    <span className="text-muted-foreground">
                      {g.memberCount} member{g.memberCount === 1 ? "" : "s"}
                    </span>
                    {editor && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove group dependency ${g.name}`}
                        onClick={() =>
                          removeEdge.mutate({
                            id: product!.id,
                            kind: "depends-on",
                            otherId: g.id,
                            targetKind: "group",
                          })
                        }
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <h2 className="text-lg font-semibold">Inherited</h2>
          {data.components.inherited.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No inherited dependencies — this product composes nothing.
            </p>
          ) : (
            componentTable(data.components.inherited)
          )}
        </div>
      )}

      {tab === "instances" && (
        <div className="space-y-6">
          <h2 className="text-lg font-semibold">Declared</h2>
          {instanceTable(data.instances.declared)}
          <h2 className="text-lg font-semibold">Inherited</h2>
          {instanceTable(data.instances.inherited)}
        </div>
      )}

      <ProductForm
        open={editOpen}
        onClose={() => setEditOpen(false)}
        product={product}
      />
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {product.name}?</DialogTitle>
          </DialogHeader>
          <p className="py-2 text-sm text-muted-foreground">
            Hard delete is only allowed while the product has no edges;
            otherwise it must be retired instead. This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={del.isPending}
            >
              {del.isPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {edgePicker && (
        <EdgePicker
          open
          target={edgePicker}
          productId={product.id}
          onClose={() => setEdgePicker(null)}
          onAdd={async (body) => {
            await addEdge.mutateAsync({ id: product!.id, kind: edgePicker.kind, body });
          }}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">History</CardTitle>
        </CardHeader>
        <CardContent>
          <EntityHistory entityType="digital_product" entityId={product.id} />
        </CardContent>
      </Card>
    </div>
  );
}
