import Link from "next/link";

import { LOT_STATUSES, STATUS_LABELS } from "@/lib/lot-status";
import type { Pipeline } from "@/lib/lots";

const mt = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 0 })} MT`;

export function PipelineBoard({ pipeline }: { pipeline: Pipeline }) {
  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-max gap-3">
        {LOT_STATUSES.map((status) => {
          const cards = pipeline.columns[status];
          return (
            <div key={status} className="flex w-64 shrink-0 flex-col gap-2">
              <div className="flex items-center justify-between px-1">
                <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                  {STATUS_LABELS[status]}
                </span>
                <span className="font-mono text-xs text-muted-foreground">{cards.length}</span>
              </div>

              <div className="flex flex-col gap-2 rounded-xl border bg-muted/20 p-2">
                {cards.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">Empty</p>
                ) : (
                  cards.map((c) => (
                    <Link
                      key={c.id}
                      href={`/lots/${c.id}`}
                      className="flex flex-col gap-1 rounded-lg border bg-background p-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <span className="font-mono text-xs">{c.lot_number}</span>
                      <span className="text-sm font-medium">{c.commodity}</span>
                      <span className="truncate text-xs text-muted-foreground">{c.client}</span>
                      <span className="font-mono text-[0.6875rem] text-muted-foreground">
                        {mt(c.quantity_mt)} · {c.bags.toLocaleString("en-US")} bags
                      </span>
                    </Link>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
