export type ReportRange = "month" | "90d" | "all";
export type Bounds = { from: string | null; to: string | null };

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** All computation is in UTC so bounds are timezone-independent. */
export function rangeBounds(range: ReportRange, today: Date): Bounds {
  if (range === "all") return { from: null, to: null };
  const to = iso(today);
  if (range === "month") {
    return { from: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), to };
  }
  return { from: iso(new Date(today.getTime() - 90 * 86_400_000)), to };
}

export function marginPct(profit: number, revenue: number): number {
  return revenue > 0 ? (profit / revenue) * 100 : 0;
}

export const RANGE_LABELS: Record<ReportRange, string> = {
  month: "This Month",
  "90d": "90 Days",
  all: "All Time",
};
