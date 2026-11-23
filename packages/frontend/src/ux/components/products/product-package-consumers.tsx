import { useEffect, useState } from "react";
import type { DepSource } from "@componode/core";
import { useProductPackageConsumers } from "@/api/hooks/product-packages";
import { CONSUMERS_PAGE_SIZE } from "@/api/hooks/packages";
import { ConsumersReadout } from "@/ux/components/catalog/package-consumers";

/** DepSource → reachability label for the product roll-up consumers table. */
export function depSourceLabel(source: DepSource): string {
  switch (source.kind) {
    case "DIRECT":
      return "Direct edge";
    case "GROUP":
      return `Group · ${source.group.name}`;
    case "INHERITED":
      return `Inherited · ${source.product.name}`;
  }
}

/**
 * Spec 080 US2 — expanded consumers panel inside a product Packages row:
 * the product-scoped consumers read plus the reachability attribution
 * column (how each contributing component is reachable from the product).
 * Shares `ConsumersReadout` with the /packages explorer — no fork.
 */
export function ProductPackageConsumersPanel({
  slug,
  purl,
  version,
  onVersionFilter,
}: {
  slug: string;
  purl: string;
  version?: string;
  onVersionFilter?: (version: string | undefined) => void;
}) {
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [slug, purl, version]);
  const { data, isPending, error, refetch } = useProductPackageConsumers(
    slug,
    purl,
    { version, page, pageSize: CONSUMERS_PAGE_SIZE },
  );

  return (
    <ConsumersReadout
      data={data}
      isPending={isPending}
      error={error}
      refetch={() => void refetch()}
      page={page}
      onPageChange={setPage}
      pageSize={CONSUMERS_PAGE_SIZE}
      purl={purl}
      version={version}
      onVersionFilter={onVersionFilter}
      emptyText={`No components in this product's dependency set report this package${version ? ` at version ${version}` : ""}`}
      attributionOf={(c) => depSourceLabel(c.depSource)}
    />
  );
}
