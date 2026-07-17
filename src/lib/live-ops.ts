import "server-only";

import { createClient } from "@/lib/supabase/server";

const num = (v: unknown): number => Number(v ?? 0);

export type LiveRow = {
  id: string;
  lot_number: string;
  direction: "import" | "export";
  status: string;
  commodity: string;
  client: string;
  carrier: string | null;
  quantity_mt: number;
  bags: number;
  market_value: number | null; // NULL for non-financial roles (lots_view masks it)
};

/** Reads lots_view, so market_value is already masked for non-financial roles. */
export async function getLiveRows(): Promise<LiveRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lots_view")
    .select("id, lot_number, direction, status, quantity_mt, bags, market_value, vessel_name, commodities!inner(name), clients!inner(name)")
    .order("lot_number", { ascending: false });
  if (error) throw new Error(`getLiveRows: ${error.message}`);

  type Row = {
    id: string; lot_number: string; direction: "import" | "export"; status: string;
    quantity_mt: unknown; bags: unknown; market_value: unknown; vessel_name: string | null;
    commodities: { name: string }; clients: { name: string };
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    lot_number: r.lot_number,
    direction: r.direction,
    status: r.status,
    commodity: r.commodities.name,
    client: r.clients.name,
    carrier: r.vessel_name,
    quantity_mt: num(r.quantity_mt),
    bags: num(r.bags),
    market_value: r.market_value == null ? null : num(r.market_value),
  }));
}

export function carrierGroups(rows: LiveRow[]): { carrier: string; lots: number; mt: number }[] {
  const map = new Map<string, { carrier: string; lots: number; mt: number }>();
  for (const r of rows) {
    const key = r.carrier ?? "Unassigned";
    const g = map.get(key) ?? { carrier: key, lots: 0, mt: 0 };
    g.lots++;
    g.mt += r.quantity_mt;
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => b.mt - a.mt);
}
