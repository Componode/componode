import { useEffect, useState } from "react";
import { useDebouncedValue } from "@/ux/hooks/use-debounced-value";

/**
 * Debounced free-text param bound to list state — the shared core of
 * `useListSearch` (search, unset = `""`) and the activity page's filter
 * inputs (unset = `"all"`) (spec 069 / B.4).
 *
 * The raw input stays responsive while the committed value lands in the
 * URL ~300 ms after typing stops — one request per pause, not per
 * keystroke. The hook syncs BOTH ways: external navigation (back/forward,
 * a shared link, Clear) rewrites the input, and the input's debounced
 * value writes back through `commit` once it differs from `value`.
 *
 * `unset` is the sentinel meaning "no filter": it displays as an empty
 * input and an emptied input commits as `unset`. Pass `""` for plain
 * search params, `"all"` for `useListState` filter params.
 *
 * Returns `[inputValue, setInputValue]` — pass `inputValue` to the
 * input's `value`/`onChange`.
 */
export function useDebouncedParam(
  value: string,
  commit: (value: string) => void,
  unset = "",
): [string, (value: string) => void] {
  const shown = value === unset ? "" : value;
  const [input, setInput] = useState(shown);
  const debounced = useDebouncedValue(input);

  // URL → input: external navigation or a programmatic commit rewrites
  // the field (guarded — same-value writes are no-ops).
  useEffect(() => {
    setInput(shown);
  }, [shown]);

  // input → URL: commit the debounced text once it differs from state,
  // mapping an empty input back to the unset sentinel. `commit` identity
  // changes every render — the value comparison is the real guard.
  useEffect(() => {
    const next = debounced === "" ? unset : debounced;
    if (next !== value) commit(next);
  }, [debounced, value, unset]);

  return [input, setInput];
}
