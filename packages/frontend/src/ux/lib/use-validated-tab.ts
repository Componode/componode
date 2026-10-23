import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

/**
 * Reads ?tab= against a route's tab list. Unknown or missing values fall
 * back to the first tab so deep links never render an empty panel.
 * setTab replaces the history entry so tab switches don't stack.
 */
export function useValidatedTab<T extends string>(
  tabs: readonly T[],
): [T, (tab: T) => void] {
  const [searchParams] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const requested = searchParams.get("tab");
  const tab = (tabs as readonly string[]).includes(requested ?? "")
    ? (requested as T)
    : (tabs[0] as T);

  const setTab = (value: T) =>
    navigate(`${pathname}?tab=${value}`, { replace: true });

  return [tab, setTab];
}
