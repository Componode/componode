/**
 * Prefixes a prototype-absolute path with the staged `/ux` mount point.
 * Prototype sources write `to="/products"`; under staging that must resolve
 * to `/ux/products` so links stay inside the staged tree. At cutover (T045)
 * this becomes an identity and the call sites are flattened.
 */
export function ux(path: string): string {
  if (path === "/" || path === "") return "/ux";
  return `/ux${path}`;
}
