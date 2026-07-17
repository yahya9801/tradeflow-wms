import "server-only";

import { getPipeline } from "@/lib/lots";
import { listWarehouses, type WarehouseOccupancy } from "@/lib/warehouses";
import { createClient } from "@/lib/supabase/server";

export type DashboardOps = {
  pipeline: { in_transit_mt: number; stored_mt: number; in_transit_lots: number; stored_lots: number; total_lots: number };
  overallOccupancyPct: number;
  warehouses: WarehouseOccupancy[];
  recent: { id: string; lot_number: string; status: string; updated_at: string }[];
};

/** Operational figures for every role. Money is added by the page under a gate. */
export async function getDashboardOps(): Promise<DashboardOps> {
  const [imports, exports, warehouses] = await Promise.all([
    getPipeline("import"),
    getPipeline("export"),
    listWarehouses(),
  ]);

  const in_transit_mt = tallyMt(imports, "in_transit") + tallyMt(exports, "in_transit");
  const stored_mt = tallyMt(imports, "stored") + tallyMt(exports, "stored");
  const in_transit_lots = imports.stats.in_transit + exports.stats.in_transit;
  const stored_lots = imports.stats.stored + exports.stats.stored;
  const total_lots = imports.stats.total + exports.stats.total;

  const totalCap = warehouses.reduce((s, w) => s + w.shed_capacity_mt, 0);
  const totalUsed = warehouses.reduce((s, w) => s + w.stored_mt, 0);
  const overallOccupancyPct = totalCap > 0 ? (totalUsed / totalCap) * 100 : 0;

  const supabase = await createClient();
  const { data: recent } = await supabase
    .from("lots")
    .select("id, lot_number, status, updated_at")
    .order("updated_at", { ascending: false })
    .limit(6);

  return {
    pipeline: { in_transit_mt, stored_mt, in_transit_lots, stored_lots, total_lots },
    overallOccupancyPct,
    warehouses,
    recent: (recent ?? []) as DashboardOps["recent"],
  };
}

function tallyMt(p: Awaited<ReturnType<typeof getPipeline>>, status: "in_transit" | "stored"): number {
  return (p.columns[status] ?? []).reduce((s, c) => s + c.quantity_mt, 0);
}
