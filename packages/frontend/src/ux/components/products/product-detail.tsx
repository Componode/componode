import { safeUrl } from "@/ux/lib/safe-url";
import { ExternalLinkIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, SparklesIcon, TrashIcon } from "lucide-react"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { useAcceptSuggestion } from "@/api/hooks/suggestions"
import { useDeleteProduct, useUpdateProduct } from "@/api/hooks/products"
import { ConfirmDialog } from "@/ux/components/patterns/confirm-dialog"
import { PageContainer, PageHeader } from "@/ux/components/patterns/page-header"
import { DescriptionList, RelativeTime } from "@/ux/components/patterns/primitives"
import { ProviderMark } from "@/ux/components/patterns/provider-mark"
import { CriticalityBadge, HealthBadge, LifecycleBadge, ProductTypeBadge } from "@/ux/components/patterns/status-badge"
import { ActivityFeed } from "@/ux/components/patterns/activity-feed"
import { ProductMap } from "@/ux/components/products/product-map"
import { Alert, AlertDescription, AlertTitle } from "@/ux/components/ui/alert"
import { Badge } from "@/ux/components/ui/badge"
import { Button } from "@/ux/components/ui/button"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/ux/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ux/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/ux/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ux/components/ui/tabs"
import { CATEGORY_LABELS } from "@/ux/lib/domain"
import { ux } from "@/ux/lib/paths"
import { useValidatedTab } from "@/ux/lib/use-validated-tab"
import type { AuditEvent, Product, ProductComponentRow, Suggestion } from "@/ux/lib/view-types"

const TABS = ["overview", "map", "components", "dependencies", "activity"] as const

export interface ProductDetailProps {
  product: Product
  components: ProductComponentRow[]
  consumers: { id: string; name: string; slug: string }[]
  suggestions: Suggestion[]
  activity: AuditEvent[]
}

export function ProductDetail({ product, components, consumers, suggestions, activity }: ProductDetailProps) {
  const navigate = useNavigate()
  const [tab, setTab] = useValidatedTab(TABS)
  const updateProduct = useUpdateProduct()
  const deleteProduct = useDeleteProduct()
  const acceptSuggestion = useAcceptSuggestion()

  const missing = Object.entries(product.completeness).filter(([, v]) => !v).map(([k]) => k)

  const retire = () =>
    updateProduct.mutate(
      { id: product.id, lifecycle: "RETIRED" },
      {
        onSuccess: () => toast.success("Product marked as retired"),
        onError: (e) => toast.error(e.message),
      },
    )

  const remove = () =>
    deleteProduct.mutate(product.id, {
      onSuccess: () => {
        toast.success(`${product.name} deleted`)
        navigate(ux("/products"))
      },
      onError: (e) => toast.error(e.message),
    })

  return (
    <PageContainer>
      <PageHeader
        title={product.name}
        description={product.description ?? <span className="italic">No description yet</span>}
        meta={
          <>
            <ProductTypeBadge value={product.type} />
            <CriticalityBadge value={product.criticality} />
            {product.lifecycle === "RETIRED" ? <LifecycleBadge value="RETIRED" /> : <HealthBadge value={product.status} />}
            {product.tags.map((t) => (
              <Badge key={t} variant="secondary" className="font-mono">
                #{t}
              </Badge>
            ))}
          </>
        }
        actions={
          <>
            <Button variant="outline" asChild>
              <Link to={ux(`/products/${product.slug}/edit`)}>
                <PencilIcon data-icon="inline-start" />
                Edit
              </Link>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="icon" aria-label="More actions">
                  <MoreHorizontalIcon />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onSelect={retire}
                    disabled={product.lifecycle === "RETIRED" || updateProduct.isPending}
                  >
                    Retire product
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link to={ux(`/products/${product.slug}/history`)}>View history</Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      void navigator.clipboard.writeText(product.slug)
                      toast("Slug copied")
                    }}
                  >
                    Copy slug
                  </DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <ConfirmDialog
                    trigger={
                      <DropdownMenuItem variant="destructive" onSelect={(e) => e.preventDefault()}>
                        <TrashIcon />
                        Delete product
                      </DropdownMenuItem>
                    }
                    title={`Delete ${product.name}?`}
                    description={`This removes the product and its ${product.componentCount} composition edges. Components themselves are kept.`}
                    confirmLabel="Delete product"
                    typeToConfirm={product.slug}
                    onConfirm={remove}
                  />
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      {missing.length > 0 && (
        <Alert>
          <SparklesIcon />
          <AlertTitle>This product is missing {missing.join(" and ")}</AlertTitle>
          <AlertDescription>Complete products are easier to triage during incidents.</AlertDescription>
        </Alert>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as (typeof TABS)[number])} className="gap-6">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="map">Map</TabsTrigger>
          <TabsTrigger value="components">
            Components <span className="tabular text-muted-foreground">{components.length}</span>
          </TabsTrigger>
          <TabsTrigger value="dependencies">Dependencies</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <DescriptionList
                items={[
                  { label: "Line of business", value: product.lobOwnerName ?? "—" },
                  { label: "Owning team", value: product.teamOwnerName ?? <span className="text-muted-foreground">Unowned</span> },
                  { label: "Slug", value: <code className="font-mono text-xs">{product.slug}</code> },
                  { label: "Consumed by", value: `${product.consumedByCount ?? 0} products` },
                  { label: "Sunset", value: product.sunsetAt ?? "Not scheduled" },
                  { label: "Last updated", value: <RelativeTime iso={product.updatedAt} /> },
                ]}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Links</CardTitle>
              <CardAction>
                <Button variant="ghost" size="icon-sm" aria-label="Add link">
                  <PlusIcon />
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>
              {product.links.length ? (
                <ul className="flex flex-col gap-2">
                  {product.links.map((l) => (
                    <li key={l.url}>
                      <a
                        href={safeUrl(l.url)}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted/50"
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="font-medium">{l.title}</span>
                          <span className="truncate text-xs text-muted-foreground">{l.url}</span>
                        </span>
                        <ExternalLinkIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">Add runbooks, dashboards and docs.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="map">
          <ProductMap product={product} consumers={consumers} components={components} />
        </TabsContent>

        <TabsContent value="components">
          <Card className="overflow-hidden py-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="pl-4">Component</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Instances</TableHead>
                  <TableHead className="pr-4 text-right">Last seen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {components.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="pl-4">
                      <Link to={ux(`/components/${c.slug}`)} className="flex items-center gap-2.5 font-mono text-sm underline-offset-4 hover:underline">
                        {c.provider ? <ProviderMark provider={c.provider} size="sm" /> : null}
                        {c.name}
                      </Link>
                    </TableCell>
                    <TableCell>{CATEGORY_LABELS[c.category] ?? c.category}</TableCell>
                    <TableCell className="text-muted-foreground">{c.sources.join(", ") || "—"}</TableCell>
                    <TableCell className="tabular text-right">{c.instanceCount ?? "—"}</TableCell>
                    <TableCell className="pr-4 text-right text-muted-foreground">
                      <RelativeTime iso={c.lastSeenAt} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </TabsContent>

        <TabsContent value="dependencies" className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Consumed by</CardTitle>
              <CardDescription>Products that depend on {product.name}.</CardDescription>
            </CardHeader>
            <CardContent>
              {consumers.length ? (
                <ul className="flex flex-col divide-y">
                  {consumers.map((p) => (
                    <li key={p.id} className="flex items-center justify-between py-2.5">
                      <Link to={ux(`/products/${p.slug}`)} className="text-sm font-medium underline-offset-4 hover:underline">
                        {p.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No products consume this one yet.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Suggested edges</CardTitle>
              <CardDescription>Staged DEPENDS_ON candidates. Accept to wire.</CardDescription>
            </CardHeader>
            <CardContent>
              {suggestions.length ? (
                <ul className="flex flex-col gap-3">
                  {suggestions.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 rounded-md border p-3">
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="text-sm">
                          <span className="font-mono text-xs text-muted-foreground">{s.kind.replace("_", " ")}</span> {s.to}
                        </span>
                        <span className="truncate text-xs text-muted-foreground">{s.reason}</span>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={acceptSuggestion.isPending}
                        onClick={() =>
                          acceptSuggestion.mutate(s.id, {
                            onSuccess: () => toast.success("Edge added"),
                            onError: (e) => toast.error(e.message),
                          })
                        }
                      >
                        Accept
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No suggestions right now.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card>
            <CardContent>
              {activity.length ? (
                <ActivityFeed events={activity} />
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">No activity recorded yet.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </PageContainer>
  )
}
