import "server-only";

import { createClient } from "@/lib/supabase/server";

const num = (v: unknown): number => Number(v ?? 0);

export type ClientRow = {
  id: string;
  name: string;
  type: string;
  country: string | null;
  lot_count: number;
};

export type Client = {
  id: string;
  name: string;
  type: string;
  country: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  currency: string;
};

export type ClientStats = { lots: number; total_mt: number; imports: number; exports: number };

export type ClientLotRow = {
  id: string;
  lot_number: string;
  direction: "import" | "export";
  status: string;
  commodity: string;
  quantity_mt: number;
};

export type ClientInvoiceRow = {
  id: string;
  invoice_no: string;
  lot_number: string | null;
  type: "receivable" | "payable";
  status: string;
  currency: string;
  amount: number;
  amount_paid: number;
  due_date: string | null;
};

/**
 * Directory rows with a lot count each. `type` filter: a `both` client matches
 * `buyer` and `supplier` (and `all`). Name search is a single-column ilike,
 * which supabase-js encodes as a normal parameter — no logic-tree escaping
 * needed (unlike the multi-field `.or()` search on the lots list).
 */
export async function listClientsDirectory(opts: { q?: string; type?: string }): Promise<{
  rows: ClientRow[];
  counts: { buyers: number; suppliers: number; withLots: number };
}> {
  const supabase = await createClient();

  let query = supabase.from("clients").select("id, name, type, country").order("name");
  if (opts.type === "buyer") query = query.in("type", ["buyer", "both"]);
  else if (opts.type === "supplier") query = query.in("type", ["supplier", "both"]);
  if (opts.q?.trim()) query = query.ilike("name", `%${opts.q.trim()}%`);

  const { data: clients, error } = await query;
  if (error) throw new Error(`listClientsDirectory: ${error.message}`);

  // Lot counts per client, in one grouped read merged in JS (there are ~80 clients).
  const { data: lots } = await supabase.from("lots").select("client_id");
  const lotCounts = new Map<string, number>();
  for (const l of lots ?? []) lotCounts.set(l.client_id, (lotCounts.get(l.client_id) ?? 0) + 1);

  const rows: ClientRow[] = (clients ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    country: c.country,
    lot_count: lotCounts.get(c.id) ?? 0,
  }));

  // Directory-wide counts (independent of the active filter).
  const { data: allClients } = await supabase.from("clients").select("type");
  let buyers = 0;
  let suppliers = 0;
  for (const c of allClients ?? []) {
    if (c.type === "buyer" || c.type === "both") buyers++;
    if (c.type === "supplier" || c.type === "both") suppliers++;
  }

  return { rows, counts: { buyers, suppliers, withLots: lotCounts.size } };
}

export async function getClient(id: string): Promise<Client | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("clients")
    .select("id, name, type, country, contact_name, email, phone, currency")
    .eq("id", id)
    .maybeSingle();
  return data ? { ...data, currency: data.currency ?? "USD" } : null;
}

/** Operational only — never gated. */
export async function getClientStats(id: string): Promise<ClientStats> {
  const supabase = await createClient();
  const { data } = await supabase.from("lots").select("direction, quantity_mt").eq("client_id", id);
  let total_mt = 0;
  let imports = 0;
  let exports = 0;
  for (const l of data ?? []) {
    total_mt += num(l.quantity_mt);
    if (l.direction === "import") imports++;
    else exports++;
  }
  return { lots: data?.length ?? 0, total_mt, imports, exports };
}

export async function getClientLots(id: string): Promise<ClientLotRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lots_view")
    .select("id, lot_number, direction, status, quantity_mt, commodities!inner(name)")
    .eq("client_id", id)
    .order("lot_number", { ascending: false });
  if (error) throw new Error(`getClientLots: ${error.message}`);

  type Row = {
    id: string; lot_number: string; direction: "import" | "export"; status: string;
    quantity_mt: unknown; commodities: { name: string };
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    lot_number: r.lot_number,
    direction: r.direction,
    status: r.status,
    commodity: r.commodities.name,
    quantity_mt: num(r.quantity_mt),
  }));
}

/** RLS returns nothing here for Management — the mask is the database. */
export async function getClientInvoices(id: string): Promise<ClientInvoiceRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("invoices")
    .select("id, invoice_no, type, status, currency, amount, amount_paid, due_date, lots(lot_number)")
    .eq("client_id", id)
    .order("invoice_no");

  type Row = {
    id: string; invoice_no: string; type: "receivable" | "payable"; status: string;
    currency: string; amount: unknown; amount_paid: unknown; due_date: string | null;
    lots: { lot_number: string } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    invoice_no: r.invoice_no,
    lot_number: r.lots?.lot_number ?? null,
    type: r.type,
    status: r.status,
    currency: r.currency,
    amount: num(r.amount),
    amount_paid: num(r.amount_paid),
    due_date: r.due_date,
  }));
}
