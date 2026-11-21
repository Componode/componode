import * as React from "react"
import { Link, useNavigate } from "react-router-dom"
import { toast } from "sonner"
import { COMPONENT_PROVIDER_GROUP_META } from "@componode/core"
import {
  useAddToCatalog,
  useAddToCatalogPreview,
  useLinkPackage,
} from "@/api/hooks/bom-curation"
import { describeApiError, type ApiError } from "@/api/client"
import { MonoValue, DescriptionList } from "@/ux/components/patterns/primitives"
import { Badge } from "@/ux/components/ui/badge"
import { Button } from "@/ux/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/ux/components/ui/dialog"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/ux/components/ui/field"
import { RadioGroup, RadioGroupItem } from "@/ux/components/ui/radio-group"
import { Skeleton } from "@/ux/components/ui/skeleton"
import { CATEGORY_LABELS, PROVIDER_META } from "@/ux/lib/domain"
import { ux } from "@/ux/lib/paths"

/**
 * Spec 075 (UX-ADD-01…07) — the Add-to-catalog / Link dialog. The preview
 * read decides the mode: `existingComponent` non-null switches to Link
 * mode (never create a duplicate). Both writes are atomic server-side —
 * a failure leaves nothing behind, so the dialog shows an inline error
 * with Retry.
 */
export function BomAddToCatalogDialog({
  purl,
  open,
  onOpenChange,
  onDone,
}: {
  purl: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onDone?: () => void
}) {
  const navigate = useNavigate()
  const preview = useAddToCatalogPreview(open ? purl : null)
  const add = useAddToCatalog()
  const link = useLinkPackage()
  const [linkConsumers, setLinkConsumers] = React.useState(true)
  const [writeError, setWriteError] = React.useState<string | null>(null)

  // Reset per open — never leak a previous package's choice or error.
  React.useEffect(() => {
    if (!open) return
    setLinkConsumers(true)
    setWriteError(null)
  }, [open, purl])

  const data = preview.data ?? null
  const linkMode = data?.existingComponent != null
  const pending = add.isPending || link.isPending

  const submit = () => {
    if (!data || purl == null) return
    setWriteError(null)
    const onSuccess = (componentName: string, slug: string) => {
      toast.success(
        linkMode
          ? `Linked ${data.name} to ${componentName}`
          : `Added ${data.name} to the catalog`,
        {
          action: {
            label: "View",
            onClick: () => navigate(ux(`/components/${slug}`)),
          },
        },
      )
      onDone?.()
      onOpenChange(false)
    }
    const onError = (err: unknown) =>
      setWriteError(describeApiError(err as ApiError, "Could not complete the change"))
    if (linkMode) {
      link.mutate(
        { purl, componentId: data.existingComponent!.id, linkConsumers },
        { onSuccess: (res) => onSuccess(res.component.name, res.component.slug), onError },
      )
    } else {
      add.mutate(
        { purl, linkConsumers },
        { onSuccess: (res) => onSuccess(res.component.name, res.component.slug), onError },
      )
    }
  }

  const primaryLabel = !data
    ? "Add to catalog"
    : linkMode
      ? linkConsumers
        ? `Link all ${data.consumerCount} components`
        : "Link"
      : linkConsumers
        ? `Add and link ${data.consumerCount} components`
        : "Add to catalog"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {data
              ? linkMode
                ? `Link ${data.name} to ${data.existingComponent!.name}`
                : `Add ${data.name} to the catalog`
              : "Add to catalog"}
          </DialogTitle>
          {data && !linkMode ? (
            <DialogDescription>
              Creates one Library component that every component using{" "}
              {data.name} can depend on. Versions stay on each
              component&apos;s own bill of materials.
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {preview.isPending ? (
          <div className="flex flex-col gap-2" aria-label="Loading preview">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : preview.error ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-destructive" role="alert">
              {describeApiError(preview.error as unknown as ApiError, "Preview unavailable")}
            </p>
            <div>
              <Button variant="outline" size="sm" onClick={() => void preview.refetch()}>
                Retry
              </Button>
            </div>
          </div>
        ) : data ? (
          <div className="flex flex-col gap-4">
            {linkMode ? (
              <p className="text-sm text-muted-foreground">
                Matches existing component{" "}
                <Link
                  to={ux(`/components/${data.existingComponent!.slug}`)}
                  className="font-medium text-primary hover:underline"
                >
                  {data.existingComponent!.name}
                </Link>{" "}
                ({CATEGORY_LABELS[data.existingComponent!.category] ?? data.existingComponent!.category},{" "}
                {PROVIDER_META[data.existingComponent!.provider]?.label ?? data.existingComponent!.provider})
                — linking never creates a duplicate.
              </p>
            ) : null}
            <DescriptionList
              items={[
                { label: "Name", value: data.name },
                {
                  label: "Category",
                  value: CATEGORY_LABELS[data.category] ?? data.category,
                },
                {
                  label: "Provider",
                  value: `${PROVIDER_META[data.provider]?.label ?? data.provider} · ${COMPONENT_PROVIDER_GROUP_META[data.providerGroup].label}`,
                },
                { label: "Identity", value: <MonoValue value={data.identity} /> },
                {
                  label: "Used by",
                  value: (
                    <Link
                      to={ux(`/packages?q=${encodeURIComponent(data.identity)}`)}
                      className="text-primary hover:underline"
                    >
                      Used by {data.consumerCount} components
                    </Link>
                  ),
                },
                {
                  label: "Versions",
                  value:
                    data.versions.length > 0 ? (
                      <span className="flex flex-wrap items-center gap-1">
                        {data.versions.map((v) => (
                          <Badge key={v.version} variant="outline" className="font-mono">
                            {v.version} × {v.componentCount}
                          </Badge>
                        ))}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    ),
                },
              ]}
            />
            {data.mappedFrom ? (
              <p className="text-xs text-muted-foreground">
                Mapped from CycloneDX type {data.mappedFrom.cdxType ?? "unknown"} / ecosystem{" "}
                {data.mappedFrom.ecosystem}
              </p>
            ) : null}

            <RadioGroup
              value={linkConsumers ? "link" : "stage"}
              onValueChange={(v) => setLinkConsumers(v === "link")}
              aria-label="Outcome"
            >
              <Field orientation="horizontal">
                <RadioGroupItem value="link" id="bom-curation-link" />
                <FieldContent>
                  <FieldLabel htmlFor="bom-curation-link" className="font-medium">
                    Link all {data.consumerCount} components
                  </FieldLabel>
                  <FieldDescription>
                    Creates dependency edges for every component reporting this
                    package — one atomic change.
                  </FieldDescription>
                </FieldContent>
              </Field>
              <Field orientation="horizontal">
                <RadioGroupItem value="stage" id="bom-curation-stage" />
                <FieldContent>
                  <FieldLabel htmlFor="bom-curation-stage" className="font-medium">
                    {linkMode
                      ? "Link and stage suggestions"
                      : "Only add to catalog"}
                  </FieldLabel>
                  <FieldDescription>
                    Stages a suggestion per consumer — a human still decides
                    each edge.
                  </FieldDescription>
                </FieldContent>
              </Field>
            </RadioGroup>

            {writeError ? (
              <div className="flex items-center justify-between gap-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
                <p className="text-sm text-destructive" role="alert">
                  {writeError}
                </p>
                <Button variant="outline" size="sm" onClick={submit} disabled={pending}>
                  Retry
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={!data || pending}
            data-testid="bom-curation-submit"
          >
            {pending ? "Working…" : primaryLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
