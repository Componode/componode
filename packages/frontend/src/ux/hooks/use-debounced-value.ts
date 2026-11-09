import { useEffect, useState } from "react";

/**
 * Returns `value` after it has stopped changing for `delayMs` — the standard
 * ~300 ms debounce for list search inputs (spec 068 FR-006). The returned
 * value is what should feed `useListState().setSearch` / API params; the
 * raw input stays responsive.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
