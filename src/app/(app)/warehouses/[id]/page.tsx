import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ChevronLeft } from "lucide-react";

import { OccupancyBar, OccupancyBadge, occupancyState } from "@/components/occupancy-bar";
import { getWarehouse, listSheds, getOccupancyThreshold } from "@/lib/warehouses";
import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { can } from "@/lib/permissions";
import { WarehouseDialog } from "../warehouse-dialog";
import { ShedDialog } from "./shed-dialog";
import { DeleteShedButton } from "./delete-shed-button";

const mt = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 0 })} MT`;

export default async function FacilityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("view_operations");
  if (!gate.allowed) return <BlockedScreen required="view_operations" role={gate.role} />;

  const { id } = await params;
  const warehouse = await getWarehouse(id);
  if (!warehouse) notFound();

  const [sheds, threshold] = await Promise.all([listSheds(id), getOccupancyThreshold()]);
  const isOwner = can(gate.session.profile.role, "manage_users");

  const shedCapacity = sheds.reduce((sum, s) => sum + s.capacity_mt, 0);
  const stored = sheds.reduce((sum, s) => sum + s.stored_mt, 0);
  const unallocated = Math.max(0, warehouse.capacity_mt - shedCapacity);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Link
        href="/warehouses"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Warehouses
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{warehouse.name}</h1>
          <p className="text-sm text-muted-foreground">{warehouse.address ?? "No address on file"}</p>
        </div>
        {isOwner ? <WarehouseDialog warehouse={warehouse} /> : null}
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-xl border p-5 sm:grid-cols-4">
        {[
          { label: "Stored", value: mt(stored) },
          { label: "Shed capacity", value: mt(shedCapacity) },
          { label: "Rated capacity", value: mt(warehouse.capacity_mt) },
          { label: "Unallocated", value: mt(unallocated) },
        ].map((stat) => (
          <div key={stat.label} className="flex flex-col gap-1">
            <dt className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
              {stat.label}
            </dt>
            <dd className="text-lg font-semibold tabular-nums">{stat.value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Sheds</h2>
          {isOwner ? <ShedDialog warehouseId={id} /> : null}
        </div>

        {sheds.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="text-sm font-medium">No sheds in this facility</p>
            <p className="mt-1 text-sm text-muted-foreground">Add a shed to allocate storage capacity.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {sheds.map((s) => {
              const state = occupancyState(s.occupancy_pct, threshold);
              return (
                <li key={s.shed_id} className="flex items-center gap-2">
                  {/* The owner controls live OUTSIDE the Link: a <form> nested in
                      an anchor is invalid HTML and swallows the click target. */}
                  <Link
                    href={`/warehouses/${id}/sheds/${s.shed_id}`}
                    className="group flex flex-1 items-center gap-4 rounded-lg border bg-background p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{s.name}</span>
                        <OccupancyBadge state={state} />
                      </div>
                      <OccupancyBar pct={s.occupancy_pct} threshold={threshold} />
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      <span className="font-semibold tabular-nums">{s.occupancy_pct.toFixed(1)}%</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {mt(s.stored_mt)} / {mt(s.capacity_mt)}
                      </span>
                    </div>

                    <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>

                  {isOwner ? (
                    <div className="flex shrink-0 items-center gap-1">
                      <ShedDialog
                        warehouseId={id}
                        shed={{ id: s.shed_id, name: s.name, capacity_mt: s.capacity_mt }}
                      />
                      <DeleteShedButton shedId={s.shed_id} warehouseId={id} />
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
