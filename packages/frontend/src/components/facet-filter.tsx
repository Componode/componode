import { Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

export interface FacetOption<T extends string = string> {
  value: T;
  label: string;
  count?: number;
}

interface FacetFilterProps<T extends string = string> {
  title: string;
  options: readonly FacetOption<T>[];
  selected: readonly T[];
  onChange: (next: readonly T[]) => void;
  /** "multi" (default) toggles values; "single" keeps at most one — for
   *  enum surfaces whose backend accepts a single value (e.g. product type). */
  mode?: "multi" | "single";
}

/**
 * Faceted multi-select filter per the shadcn data-table convention:
 * a popover + searchable command list, with the active selection rendered
 * as removable pills inside the control (max 2, then a "+N" overflow).
 * See specs/015-ui-refresh/contracts/ui-contracts.md.
 */
export function FacetFilter<T extends string = string>({
  title,
  options,
  selected,
  onChange,
  mode = "multi",
}: FacetFilterProps<T>) {
  const pills = selected.map((value) => ({
    value,
    label: options.find((o) => o.value === value)?.label ?? value,
  }));

  function toggle(value: T) {
    if (mode === "single") {
      onChange(selected.includes(value) ? [] : [value]);
      return;
    }
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value],
    );
  }

  return (
    <Popover>
      <div
        data-facet-control={title}
        className="flex h-9 items-center gap-1.5 rounded-md border border-input bg-background pl-3 pr-1.5 text-sm shadow-sm"
      >
        <PopoverTrigger
          className="flex items-center gap-1.5 rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Filter by ${title}`}
        >
          <span className="font-medium text-muted-foreground">{title}</span>
          <ChevronsUpDown className="h-3.5 w-3.5 opacity-50" aria-hidden="true" />
        </PopoverTrigger>
        {pills.slice(0, 2).map((pill) => (
          <span
            key={pill.value}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground"
          >
            {pill.label}
            <button
              type="button"
              aria-label={`Remove ${pill.label}`}
              className="rounded-full hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              onClick={() => toggle(pill.value)}
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        {pills.length > 2 && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
            +{pills.length - 2}
          </span>
        )}
      </div>
      <PopoverContent className="w-[220px] p-0" align="start">
        <Command>
          <CommandInput placeholder={title} />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup>
              {options.map((o) => {
                const isSelected = selected.includes(o.value);
                return (
                  <CommandItem
                    key={o.value}
                    value={o.label}
                    onSelect={() => toggle(o.value)}
                  >
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-[4px] border",
                        isSelected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-input",
                      )}
                      aria-hidden="true"
                    >
                      {isSelected && <Check className="h-3 w-3" />}
                    </span>
                    <span className="truncate">{o.label}</span>
                    {o.count != null && (
                      <span className="ml-auto text-xs text-muted-foreground">
                        {o.count}
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
            {selected.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    onSelect={() => onChange([])}
                    className="justify-center"
                  >
                    Clear
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
