import { useEffect, useRef, useState } from "react";
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
  const [input, setInputRaw] = useState(shown);
  const debounced = useDebouncedValue(input);
  // True only between a user edit and the next URL→input sync — commits
  // are allowed only for text the user actually typed. An external reset
  // (e.g. Clear filters) clears the flag before the stale debounced value
  // can be re-committed over it.
  const dirtyRef = useRef(false);
  const setInput = (v: string) => {
    dirtyRef.current = true;
    setInputRaw(v);
  };

  // URL → input: external navigation or a programmatic commit rewrites
  // the field (guarded — same-value writes are no-ops).
  useEffect(() => {
    dirtyRef.current = false;
    setInputRaw(shown);
  }, [shown]);

  // input → URL: commit the debounced text once it differs from state,
  // mapping an empty input back to the unset sentinel. `commit` identity
  // changes every render — the value comparison is the real guard.
  // `input !== debounced` means the debounced text is stale mid-typing.
  useEffect(() => {
    const next = debounced === "" ? unset : debounced;
    if (dirtyRef.current && input === debounced && next !== value) commit(next);
  }, [debounced, input, value, unset]);

  return [input, setInput];
}
