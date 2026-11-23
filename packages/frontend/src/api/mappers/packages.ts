import type { PackageListItem, ProductPackageListItem } from "@componode/core";
import type { PackageView, ProductPackageView } from "@/ux/lib/view-types";

/** Contract → view mapping for the /packages rollup row (spec 074).
 *  `versionsOverflow` derives the "+N more" count the chip row shows. */
export function toPackageView(item: PackageListItem): PackageView {
  return {
    ...item,
    versionsOverflow: Math.max(0, item.versionCount - item.versions.length),
  };
}

/** Contract → view mapping for the product Packages tab row (spec 080). */
export function toProductPackageView(
  item: ProductPackageListItem,
): ProductPackageView {
  return {
    ...item,
    versionsOverflow: Math.max(0, item.versionCount - item.versions.length),
  };
}
