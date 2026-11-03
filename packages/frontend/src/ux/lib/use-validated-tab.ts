import { useSearchParams } from "react-router-dom";

/**
 * Reads ?tab= against a route's tab list. Unknown or missing values fall
 * back to the first tab so deep links never render an empty panel;
 * `aliases` resolves retired tab names to their replacement (spec 059:
 * `?tab=map` → `dependencies`). setTab replaces the history entry so tab
 * switches don't stack, and preserves unrelated query params (filters,
 * incomplete=1, …).
 */
export function useValidatedTab<T extends string>(
  tabs: readonly T[],
  aliases?: Record<string, T>,
): [T, (tab: T) => void] {
  const [searchParams, setSearchParams] = useSearchParams();

  const requested = searchParams.get("tab");
  const tab = (tabs as readonly string[]).includes(requested ?? "")
    ? (requested as T)
    : requested !== null && aliases?.[requested] !== undefined
      ? aliases[requested]
      : (tabs[0] as T);

  const setTab = (value: T) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", value);
    setSearchParams(next, { replace: true });
  };

  return [tab, setTab];
}
