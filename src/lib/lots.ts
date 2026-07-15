import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { LotStatus } from "@/lib/lot-status";

const num = (v: unknown): number => Number(v ?? 0);
export const PAGE_SIZE = 25;

export type LotRow = {
  id: string;
  lot_number: string;
  direction: "import" | "export";
  status: LotStatus;
  quantity_mt: number;
  bags: number;
  commodity: string;
  client: string;
  warehouse: string | null;
  shed: string | null;
  eta: string | null;
};

export type LotDetail = LotRow & {
  commodity_id: string;
  client_id: string;
  warehouse_id: string | null;
  shed_id: string | null;
  origin_country: string | null;
  destination_country: string | null;
  vessel_name: string | null;
  bl_number: string | null;
  export_ref: string | null;
  payment_terms: string | null;
  arrival_date: string | null;
  dispatch_date: string | null;
  notes: string | null;
  /** NULL for non-financial roles — masked by lots_view in the database. */
  market_value: number | null;
  bag_weight_kg: number;
};

export type LotInvoice = {
  id: string;
  invoice_no: string;
  type: "receivable" | "payable";
  status: string;
  currency: string;
  amount: number;
  amount_paid: number;
  due_date: string | null;
};

export type LotException = {
  id: string;
  type: string;
  severity: "critical" | "warning" | "notice";
  description: string;
  status: "open" | "resolved";
  note: string | null;
  created_at: string;
};

const LIST_SELECT =
  "id, lot_number, direction, status, quantity_mt, bags, eta, commodities!inner(name), clients!inner(name), warehouses(name), sheds(name)";

type ListRaw = {
  id: string; lot_number: string; direction: "import" | "export"; status: LotStatus;
  quantity_mt: unknown; bags: unknown; eta: string | null;
  commodities: { name: string }; clients: { name: string };
  warehouses: { name: string } | null; sheds: { name: string } | null;
};

function toRow(r: ListRaw): LotRow {
  return {
    id: r.id,
    lot_number: r.lot_number,
    direction: r.direction,
    status: r.status,
    quantity_mt: num(r.quantity_mt),
    bags: num(r.bags),
    commodity: r.commodities.name,
    client: r.clients.name,
    warehouse: r.warehouses?.name ?? null,
    shed: r.sheds?.name ?? null,
    eta: r.eta,
  };
}

/**
 * Reads lots_view (never the lots table) so market_value is masked by the
 * database for non-financial roles.
 */
export async function listLots(opts: {
  q?: string;
  direction?: string;
  status?: string;
  page?: number;
}): Promise<{ rows: LotRow[]; total: number; statusCounts: Record<string, number> }> {
  const supabase = await createClient();
  const page = Math.max(1, opts.page ?? 1);

  let query = supabase.from("lots_view").select(LIST_SELECT, { count: "exact" });

  if (opts.direction === "import" || opts.direction === "export") {
    query = query.eq("direction", opts.direction);
  }
  if (opts.status) query = query.eq("status", opts.status);
  if (opts.q?.trim()) {
    // Verified against the live DB: PostgREST rejects an .or() that mixes a
    // base-table column with filters on two different embedded resources
    // (commodities.name / clients.name) — it throws "failed to parse logic
    // tree" for both service_role and anon keys. A single-resource .or() via
    // referencedTable works, but there's no PostgREST syntax to OR across
    // lot_number plus two different joined tables in one request. Documented
    // fallback: search lot_number only. Searching by commodity/client name
    // is not supported here.
    query = query.ilike("lot_number", `%${opts.q.trim()}%`);
  }

  const from = (page - 1) * PAGE_SIZE;
  const { data, count, error } = await query
    .order("lot_number", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (error) throw new Error(`listLots: ${error.message}`);

  // Status tab counts respect the other active filters but not the status one.
  const countsQuery = supabase.from("lots_view").select("status");
  if (opts.direction === "import" || opts.direction === "export") {
    countsQuery.eq("direction", opts.direction);
  }
  const { data: allStatuses } = await countsQuery;
  const statusCounts: Record<string, number> = {};
  for (const r of allStatuses ?? []) {
    statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
  }

  return {
    rows: ((data ?? []) as unknown as ListRaw[]).map(toRow),
    total: count ?? 0,
    statusCounts,
  };
}

export async function getLot(id: string): Promise<LotDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("lots_view")
    .select(
      "id, lot_number, direction, status, quantity_mt, bags, market_value, eta, arrival_date, dispatch_date, notes, origin_country, destination_country, vessel_name, bl_number, export_ref, payment_terms, commodity_id, client_id, warehouse_id, shed_id, commodities!inner(name, bag_weight_kg), clients!inner(name), warehouses(name), sheds(name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;

  const r = data as unknown as ListRaw & Record<string, unknown> & {
    commodities: { name: string; bag_weight_kg: unknown };
  };

  return {
    ...toRow(r),
    commodity_id: String(r.commodity_id),
    client_id: String(r.client_id),
    warehouse_id: (r.warehouse_id as string | null) ?? null,
    shed_id: (r.shed_id as string | null) ?? null,
    origin_country: (r.origin_country as string | null) ?? null,
    destination_country: (r.destination_country as string | null) ?? null,
    vessel_name: (r.vessel_name as string | null) ?? null,
    bl_number: (r.bl_number as string | null) ?? null,
    export_ref: (r.export_ref as string | null) ?? null,
    payment_terms: (r.payment_terms as string | null) ?? null,
    arrival_date: (r.arrival_date as string | null) ?? null,
    dispatch_date: (r.dispatch_date as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    market_value: r.market_value == null ? null : num(r.market_value),
    bag_weight_kg: num(r.commodities.bag_weight_kg),
  };
}

/** RLS returns nothing here for Management — the mask is the database, not this code. */
export async function getLotInvoices(lotId: string): Promise<LotInvoice[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("invoices")
    .select("id, invoice_no, type, status, currency, amount, amount_paid, due_date")
    .eq("lot_id", lotId)
    .order("invoice_no");

  return (data ?? []).map((i) => ({
    ...i,
    amount: num(i.amount),
    amount_paid: num(i.amount_paid),
  })) as LotInvoice[];
}

export async function getLotExceptions(lotId: string): Promise<LotException[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("exceptions")
    .select("id, type, severity, description, status, note, created_at")
    .eq("lot_id", lotId)
    .order("created_at", { ascending: false });
  return (data ?? []) as LotException[];
}

export async function listCommodities() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("commodities_view")
    .select("id, name, bag_weight_kg")
    .order("name");
  return (data ?? []).map((c) => ({ ...c, bag_weight_kg: num(c.bag_weight_kg) }));
}

export async function listClients() {
  const supabase = await createClient();
  const { data } = await supabase.from("clients").select("id, name, type, country").order("name");
  return data ?? [];
}

/** Warehouses with their sheds and live free space, for the store picker. */
export async function listWarehousesWithSheds() {
  const supabase = await createClient();
  const { data: warehouses } = await supabase.from("warehouses").select("id, name").order("name");
  const { data: sheds } = await supabase
    .from("shed_occupancy")
    .select("shed_id, warehouse_id, name, capacity_mt, stored_mt")
    .order("name");

  return (warehouses ?? []).map((w) => ({
    ...w,
    sheds: (sheds ?? [])
      .filter((s) => s.warehouse_id === w.id)
      .map((s) => ({
        id: s.shed_id,
        name: s.name,
        free_mt: num(s.capacity_mt) - num(s.stored_mt),
      })),
  }));
}
