/**
 * Internal path helper. Historically prefixed links with the staged `/ux`
 * mount; since the v1.1.0 cutover the tree lives at `/` and this is an
 * identity — kept so call sites read as "internal app link".
 */
export function ux(path: string): string {
  return path === "" ? "/" : path;
}
