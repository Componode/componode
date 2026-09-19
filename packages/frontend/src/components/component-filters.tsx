import {
  COMPONENT_CATEGORIES,
  COMPONENT_CATEGORY_META,
  COMPONENT_PROVIDERS,
  COMPONENT_PROVIDER_META,
  COMPONENT_LIFECYCLE,
  COMPONENT_LIFECYCLE_META,
  INSTANCE_STATUS,
  INSTANCE_STATUS_META,
} from "@componode/core";
import type { ComponentListFilters } from "@/api/hooks/components";
import { useComponentGroups } from "@/api/hooks/components";
import { FacetFilter, type FacetOption } from "@/components/facet-filter";
import { Button } from "@/components/ui/button";

interface ComponentFiltersProps {
  filters: ComponentListFilters;
  onChange: (filters: ComponentListFilters) => void;
}

const CATEGORY_OPTIONS: FacetOption[] = COMPONENT_CATEGORIES.map((v) => ({
  value: v,
  label: COMPONENT_CATEGORY_META[v].label,
}));
const PROVIDER_OPTIONS: FacetOption[] = COMPONENT_PROVIDERS.map((v) => ({
  value: v,
  label: COMPONENT_PROVIDER_META[v].label,
}));
const LIFECYCLE_OPTIONS: FacetOption[] = COMPONENT_LIFECYCLE.map((v) => ({
  value: v,
  label: COMPONENT_LIFECYCLE_META[v].label,
}));
const STATUS_OPTIONS: FacetOption[] = INSTANCE_STATUS.map((v) => ({
  value: v,
  label: INSTANCE_STATUS_META[v].label,
}));

const FACET_KEYS = ["category", "provider", "lifecycle", "status", "group"] as const;

function split(value: string | undefined): string[] {
  return value ? value.split(",").filter(Boolean) : [];
}

function join(values: readonly string[]): string | undefined {
  return values.length > 0 ? values.join(",") : undefined;
}

export function ComponentFilters({ filters, onChange }: ComponentFiltersProps) {
  const { data: groupsData } = useComponentGroups();
  const groupOptions: FacetOption[] = [
    { value: "none", label: "Ungrouped" },
    ...(groupsData?.groups ?? []).map((g) => ({ value: g.slug, label: g.name })),
  ];

  function update(key: keyof ComponentListFilters, values: readonly string[]) {
    onChange({ ...filters, [key]: join(values), page: 1 });
  }

  function clearAll() {
    onChange({
      ...filters,
      category: undefined,
      provider: undefined,
      lifecycle: undefined,
      status: undefined,
      group: undefined,
      page: 1,
    });
  }

  const hasActive = FACET_KEYS.some((key) => filters[key]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <FacetFilter
        title="Category"
        options={CATEGORY_OPTIONS}
        selected={split(filters.category)}
        onChange={(v) => update("category", v)}
      />
      <FacetFilter
        title="Provider"
        options={PROVIDER_OPTIONS}
        selected={split(filters.provider)}
        onChange={(v) => update("provider", v)}
      />
      <FacetFilter
        title="Lifecycle"
        options={LIFECYCLE_OPTIONS}
        selected={split(filters.lifecycle)}
        onChange={(v) => update("lifecycle", v)}
      />
      <FacetFilter
        title="Status"
        options={STATUS_OPTIONS}
        selected={split(filters.status)}
        onChange={(v) => update("status", v)}
      />
      <FacetFilter
        title="Group"
        options={groupOptions}
        selected={split(filters.group)}
        onChange={(v) => update("group", v)}
      />
      {hasActive && (
        <Button variant="ghost" size="sm" onClick={clearAll}>
          Clear all
        </Button>
      )}
    </div>
  );
}
