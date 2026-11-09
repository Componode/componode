import { useEffect, useState } from "react";
import { useDebouncedValue } from "@/ux/hooks/use-debounced-value";

interface ListSearchState {
  search: string;
  setSearch: (value: string) => void;
}

/**
 * Debounced search input bound to `useListState` (spec 068 FR-006).
 *
 * The raw input stays responsive while the committed value lands in the
 * URL ~300 ms after typing stops — one request per pause, not per
 * keystroke. The hook syncs BOTH ways: external navigation (back/forward,
 * a shared link, Clear) rewrites the input, and the input's debounced
 * value writes back through `setSearch` (which resets `page` per the
 * list-state contract).
 *
 * Returns `[inputValue, setInputValue]` — pass `inputValue` to
 * `ListToolbar`'s `query`/`onQueryChange`.
 */
export function useListSearch(state: ListSearchState): [string, (value: string) => void] {
  const [input, setInput] = useState(state.search);
  const debounced = useDebouncedValue(input);

  // URL → input: external navigation or a programmatic setSearch updates
  // the field (guarded — same-value writes are no-ops).
  useEffect(() => {
    setInput(state.search);
  }, [state.search]);

  // input → URL: commit the debounced text once it differs from state.
  // `setSearch` identity changes every render — the value comparison is
  // the real guard against loops.
  useEffect(() => {
    if (debounced !== state.search) state.setSearch(debounced);
  }, [debounced, state.search]);

  return [input, setInput];
}
