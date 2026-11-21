import * as React from "react"
import { usePackageVersions } from "@/api/hooks/bom-curation"
import { PackageConsumersPanel } from "@/ux/components/catalog/package-consumers"
import { DescriptionList, MonoValue } from "@/ux/components/patterns/primitives"
import { Badge } from "@/ux/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/ux/components/ui/card"
import { Skeleton } from "@/ux/components/ui/skeleton"
import { PROVIDER_META } from "@/ux/lib/domain"
import type { Component } from "@/ux/lib/view-types"

/**
 * Spec 075 / UX-LIB-04 — the LIBRARY detail section. A promoted package
 * has no instances; instead the card shows the package identity (purl,
 * ecosystem, provider), "Versions in use" chips, and a "Used by" list
 * (the shared `GET /packages/consumers` panel) filtered by chip.
 */
export function LibraryPackageCard({ component: c }: { component: Component }) {
  const purl = c.externalId ?? null
  const [version, setVersion] = React.useState<string | undefined>(undefined)
  const versions = usePackageVersions(purl)
  // `resourceType` is "{type}:package" (e.g. "npm:package") — the prefix
  // is the purl ecosystem fragment.
  const ecosystem = c.resourceType.split(":")[0] || c.resourceType

  return (
    <Card className="lg:col-span-2 overflow-hidden pb-0">
      <CardHeader>
        <CardTitle>Package</CardTitle>
        <CardDescription>
          One catalog component for this package — every component carrying
          it can depend on it. Versions stay on each component&apos;s own
          bill of materials.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-0">
        <div className="px-6">
          <DescriptionList
            className="sm:grid-cols-[minmax(8rem,auto)_1fr]"
            items={[
              {
                label: "Identity",
                value: purl ? (
                  <MonoValue value={purl} />
                ) : (
                  <span className="text-muted-foreground">—</span>
                ),
              },
              { label: "Ecosystem", value: <code className="font-mono text-xs">{ecosystem}</code> },
              {
                label: "Provider",
                value: PROVIDER_META[c.provider]?.label ?? c.provider,
              },
            ]}
          />
          <div className="mt-4">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Versions in use
            </p>
            {versions.isPending ? (
              <div className="flex gap-1">
                <Skeleton className="h-6 w-20" />
                <Skeleton className="h-6 w-20" />
              </div>
            ) : (versions.data?.data ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No versions reported.</p>
            ) : (
              <div className="flex flex-wrap items-center gap-1" data-testid="versions-in-use">
                {(versions.data?.data ?? []).map((v) => (
                  <button
                    key={v.version}
                    type="button"
                    onClick={() =>
                      setVersion(version === v.version ? undefined : v.version)
                    }
                    data-testid={`version-chip-${v.version}`}
                  >
                    <Badge variant={version === v.version ? "default" : "outline"}>
                      {v.version} × {v.componentCount}
                    </Badge>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        <div>
          <p className="mb-1 px-6 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Used by
          </p>
          {purl ? (
            <PackageConsumersPanel
              purl={purl}
              version={version}
              onVersionFilter={setVersion}
            />
          ) : (
            <p className="px-6 pb-4 text-sm text-muted-foreground">
              This library has no package identity.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
