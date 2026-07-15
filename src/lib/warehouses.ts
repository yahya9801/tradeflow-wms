import "server-only";

import { createClient } from "@/lib/supabase/server";

// Postgres numerics can arrive as strings; coerce once here so every consumer
// gets real numbers rather than "7923.000".
const num = (v: unknown): number => Number(v ?? 0);

export type WarehouseOccupancy = {
  warehouse_id: string;
  name: string;
  rated_capacity_mt: number;
  shed_capacity_mt: number;
  stored_mt: number;
  occupancy_pct: number;
  shed_count: number;
  unallocated_mt: number;
};

export type ShedOccupancy = {
  shed_id: string;
  warehouse_id: string;
  name: string;
  capacity_mt: number;
  stored_mt: number;
  occupancy_pct: number;
};

export type Stay = {
  id: string;
  lot_id: string;
  lot_number: string;
  commodity: string;
  client: string;
  quantity_mt: number;
  status: string;
  placed_at: string;
  removed_at: string | null;
};

export async function listWarehouses(): Promise<WarehouseOccupancy[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("warehouse_occupancy").select("*").order("name");
  if (error) throw new Error(`listWarehouses: ${error.message}`);

  return (data ?? []).map((w) => ({
    warehouse_id: w.warehouse_id,
    name: w.name,
    rated_capacity_mt: num(w.rated_capacity_mt),
    shed_capacity_mt: num(w.shed_capacity_mt),
    stored_mt: num(w.stored_mt),
    occupancy_pct: num(w.occupancy_pct),
    shed_count: num(w.shed_count),
    unallocated_mt: Math.max(0, num(w.rated_capacity_mt) - num(w.shed_capacity_mt)),
  }));
}

export async function getWarehouse(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("warehouses")
    .select("id, name, address, capacity_mt")
    .eq("id", id)
    .maybeSingle();
  return data ? { ...data, capacity_mt: num(data.capacity_mt) } : null;
}

export async function listSheds(warehouseId: string): Promise<ShedOccupancy[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shed_occupancy")
    .select("*")
    .eq("warehouse_id", warehouseId)
    .order("name");
  if (error) throw new Error(`listSheds: ${error.message}`);

  return (data ?? []).map((s) => ({
    shed_id: s.shed_id,
    warehouse_id: s.warehouse_id,
    name: s.name,
    capacity_mt: num(s.capacity_mt),
    stored_mt: num(s.stored_mt),
    occupancy_pct: num(s.occupancy_pct),
  }));
}

export async function getShed(shedId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sheds")
    .select("id, name, warehouse_id, capacity_mt")
    .eq("id", shedId)
    .maybeSingle();
  return data ? { ...data, capacity_mt: num(data.capacity_mt) } : null;
}

/** Every lot that ever occupied this shed, newest placement first. */
export async function getShedHistory(shedId: string): Promise<Stay[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lot_movements")
    .select(
      "id, lot_id, placed_at, removed_at, lots!inner(lot_number, quantity_mt, status, commodities!inner(name), clients!inner(name))",
    )
    .eq("shed_id", shedId)
    .order("placed_at", { ascending: false });
  if (error) throw new Error(`getShedHistory: ${error.message}`);

  type Row = {
    id: string;
    lot_id: string;
    placed_at: string;
    removed_at: string | null;
    lots: {
      lot_number: string;
      quantity_mt: unknown;
      status: string;
      commodities: { name: string };
      clients: { name: string };
    };
  };

  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    lot_id: r.lot_id,
    lot_number: r.lots.lot_number,
    commodity: r.lots.commodities.name,
    client: r.lots.clients.name,
    quantity_mt: num(r.lots.quantity_mt),
    status: r.lots.status,
    placed_at: r.placed_at,
    removed_at: r.removed_at,
  }));
}

/**
 * Alert threshold from settings — CLAUDE.md requires this preference to
 * genuinely drive alert logic, so it is never hardcoded.
 */
export async function getOccupancyThreshold(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "low_stock_threshold_pct")
    .maybeSingle();
  const parsed = Number(data?.value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 80;
}
