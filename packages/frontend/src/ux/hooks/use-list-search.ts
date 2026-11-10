import { useDebouncedParam } from "@/ux/hooks/use-debounced-param";

interface ListSearchState {
  search: string;
  setSearch: (value: string) => void;
}

/**
 * Debounced search input bound to `useListState` (spec 068 FR-006).
 *
 * Thin wrapper over `useDebouncedParam` with `""` as the unset sentinel —
 * see that hook for the sync contract. Returns `[inputValue,
 * setInputValue]` — pass `inputValue` to `ListToolbar`'s
 * `query`/`onQueryChange`.
 */
export function useListSearch(state: ListSearchState): [string, (value: string) => void] {
  return useDebouncedParam(state.search, state.setSearch, "");
}
