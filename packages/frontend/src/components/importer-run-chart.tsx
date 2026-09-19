import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { importerRunsQueryOptions } from "@/api/hooks/importers";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";

const SEGMENTS = [
  { key: "created", label: "Created", fill: "var(--color-success)" },
  { key: "updated", label: "Updated", fill: "var(--color-warning)" },
  { key: "unchanged", label: "Unchanged", fill: "var(--color-muted-foreground)" },
] as const;

interface RunRow {
  id: string;
  label: string;
  created: number;
  updated: number;
  unchanged: number;
  processed: number;
}

export interface ImporterRunChartProps {
  configIds: readonly string[];
  maxRuns?: number;
}

/**
 * Stacked per-run outcome chart (spec 015 US4). Fans out over
 * `useImporterRuns` per config, merges globally, trims to the most recent
 * `maxRuns` completed runs. Colors use status tokens — this is the one place
 * status hues carry data meaning (created = success hue, updated = warning
 * hue, unchanged = muted).
 */
export function ImporterRunChart({
  configIds,
  maxRuns = 20,
}: ImporterRunChartProps) {
  const queries = useQueries({
    queries: configIds.map((id) => importerRunsQueryOptions(id)),
  });
  const reducedMotion = usePrefersReducedMotion();

  const rows = useMemo<RunRow[]>(() => {
    const runs = queries
      .flatMap((q) => q.data?.runs ?? [])
      .filter((r) => r.completedAt !== null)
      .sort((a, b) => a.completedAt!.localeCompare(b.completedAt!))
      .slice(-maxRuns);
    return runs.map((r) => ({
      id: r.id,
      label: new Date(r.completedAt!).toLocaleDateString("en", {
        month: "short",
        day: "numeric",
      }),
      created: r.assetsCreated,
      updated: r.assetsUpdated,
      unchanged: Math.max(
        0,
        r.assetsProcessed - r.assetsCreated - r.assetsUpdated,
      ),
      processed: r.assetsProcessed,
    }));
  }, [queries, maxRuns]);

  const isPending = queries.some((q) => q.isPending);

  if (isPending) {
    return (
      <div
        className="flex h-40 items-center justify-center text-sm text-muted-foreground"
        role="status"
      >
        Loading run history…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        No import runs yet — history appears here after the first run
        completes.
      </p>
    );
  }

  return (
    <figure aria-label="Import run history" className="p-4">
      <div className="h-40" role="img" aria-label="Stacked bar chart of import run outcomes">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={rows}
            margin={{ top: 4, right: 8, bottom: 0, left: -18 }}
            accessibilityLayer
          >
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
            />
            <YAxis
              allowDecimals={false}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "var(--color-muted-foreground)" }}
              width={40}
            />
            <Tooltip
              cursor={{ fill: "var(--color-accent)", opacity: 0.4 }}
              contentStyle={{
                backgroundColor: "var(--color-popover)",
                border: "1px solid var(--color-border)",
                borderRadius: "var(--radius)",
                color: "var(--color-popover-foreground)",
                fontSize: 12,
              }}
              formatter={(value, name) => [
                value,
                SEGMENTS.find((s) => s.key === name)?.label ?? name,
              ]}
            />
            {SEGMENTS.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                stackId="outcome"
                fill={s.fill}
                isAnimationActive={!reducedMotion}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption>
        <ul aria-label="Chart legend" className="mt-2 flex gap-4 text-xs text-muted-foreground">
          {SEGMENTS.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span
                aria-hidden="true"
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ backgroundColor: s.fill }}
              />
              {s.label}
            </li>
          ))}
        </ul>
        <table className="sr-only">
          <caption>Import run history</caption>
          <thead>
            <tr>
              <th scope="col">Run</th>
              <th scope="col">Created</th>
              <th scope="col">Updated</th>
              <th scope="col">Unchanged</th>
              <th scope="col">Processed</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <th scope="row">{r.label}</th>
                <td>{r.created}</td>
                <td>{r.updated}</td>
                <td>{r.unchanged}</td>
                <td>{r.processed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </figcaption>
    </figure>
  );
}
