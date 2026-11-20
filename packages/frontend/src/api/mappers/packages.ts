import type { PackageListItem } from "@componode/core";
import type { PackageView } from "@/ux/lib/view-types";

/** Contract → view mapping for the /packages rollup row (spec 074).
 *  `versionsOverflow` derives the "+N more" count the chip row shows. */
export function toPackageView(item: PackageListItem): PackageView {
  return {
    ...item,
    versionsOverflow: Math.max(0, item.versionCount - item.versions.length),
  };
}
