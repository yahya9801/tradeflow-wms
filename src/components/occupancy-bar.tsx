import { cn } from "@/lib/utils";

export type OccupancyState = "normal" | "warning" | "over";

/** Threshold comes from settings.low_stock_threshold_pct — never hardcoded. */
export function occupancyState(pct: number, threshold: number): OccupancyState {
  if (pct > 100) return "over";
  if (pct >= threshold) return "warning";
  return "normal";
}

/**
 * Reserved status colors (fixed, never themed). `normal` is deliberately a
 * recessive neutral rather than "good" green — an unfull shed isn't a success,
 * it's just the resting state, and keeping it quiet lets warning/over stand out.
 *
 * #fab219 is sub-3:1 on a light surface by design; meaning is therefore never
 * carried by color alone — every non-normal state ships an icon + text label
 * beside the numeric percentage.
 */
const FILL: Record<OccupancyState, string> = {
  normal: "bg-foreground/70",
  warning: "bg-[#fab219]",
  over: "bg-[#d03b3b]",
};

export function OccupancyBar({
  pct,
  threshold,
  className,
}: {
  pct: number;
  threshold: number;
  className?: string;
}) {
  const state = occupancyState(pct, threshold);
  // The fill can't overflow its track; >100% is conveyed by the number + label.
  const width = Math.min(100, Math.max(0, pct));

  return (
    <div
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      role="meter"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Occupancy ${pct.toFixed(1)} percent`}
    >
      <div
        className={cn("h-full rounded-full transition-all", FILL[state])}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

/** Icon-and-label pairing that keeps status off color-alone. */
export function OccupancyBadge({ state }: { state: OccupancyState }) {
  if (state === "normal") return null;

  const isOver = state === "over";
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        isOver ? "bg-[#d03b3b]/10 text-[#d03b3b]" : "bg-[#fab219]/15 text-[#8a5d00] dark:text-[#fab219]",
      )}
    >
      <svg viewBox="0 0 16 16" aria-hidden className="size-3 fill-current">
        <path d="M8 1.5 15.5 14.5H.5L8 1.5Zm0 4.25a.75.75 0 0 0-.75.75v3a.75.75 0 0 0 1.5 0v-3A.75.75 0 0 0 8 5.75Zm0 6.75a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Z" />
      </svg>
      {isOver ? "Over capacity" : "Near capacity"}
    </span>
  );
}
