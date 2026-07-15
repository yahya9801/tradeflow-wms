import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { OccupancyBar, OccupancyBadge, occupancyState } from "@/components/occupancy-bar";
import { listWarehouses, getOccupancyThreshold } from "@/lib/warehouses";
import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { can } from "@/lib/permissions";
import { WarehouseDialog } from "./warehouse-dialog";

const mt = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 0 })} MT`;

export default async function WarehousesPage() {
  const gate = await requireCapability("view_operations");
  if (!gate.allowed) return <BlockedScreen required="view_operations" role={gate.role} />;

  const [warehouses, threshold] = await Promise.all([listWarehouses(), getOccupancyThreshold()]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Warehouses &amp; Sheds</h1>
          <p className="text-sm text-muted-foreground">
            Storage capacity and occupancy across facilities. Alerts at {threshold}% of shed capacity.
          </p>
        </div>
        {/* Cosmetic only — RLS refuses the write regardless of what's shown. */}
        {can(gate.session.profile.role, "manage_users") ? <WarehouseDialog /> : null}
      </div>

      {warehouses.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm font-medium">No warehouses yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Add a facility to start tracking storage.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {warehouses.map((w) => {
            const state = occupancyState(w.occupancy_pct, threshold);
            return (
              <Link
                key={w.warehouse_id}
                href={`/warehouses/${w.warehouse_id}`}
                className="group flex flex-col gap-4 rounded-xl border bg-background p-5 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{w.name}</span>
                    <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                      {w.shed_count} sheds
                    </span>
                  </div>
                  <OccupancyBadge state={state} />
                </div>

                {/* Hero: the number leads, the meter supports it. */}
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between">
                    <span className="text-2xl font-semibold tabular-nums">{w.occupancy_pct.toFixed(1)}%</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {mt(w.stored_mt)} / {mt(w.shed_capacity_mt)}
                    </span>
                  </div>
                  <OccupancyBar pct={w.occupancy_pct} threshold={threshold} />
                </div>

                <div className="flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                  <span>
                    Rated {mt(w.rated_capacity_mt)} · {mt(w.unallocated_mt)} unallocated
                  </span>
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
