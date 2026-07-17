import "server-only";

import { createClient } from "@/lib/supabase/server";
import { marginPct, rangeBounds, type ReportRange } from "@/lib/report-range";

const num = (v: unknown): number => Number(v ?? 0);

export type PnlSummary = {
  revenue: number; cost: number; gross_profit: number;
  ar_collected: number; ar_outstanding: number; ap_outstanding: number;
};

export type CommodityRow = {
  commodity: string; revenue: number; cost: number; profit: number; margin: number;
};

export type LedgerRow = {
  id: string; invoice_no: string; type: "receivable" | "payable";
  client: string | null; amount: number; currency: string;
  due_date: string | null; status: string;
};

export async function getPnlSummary(range: ReportRange): Promise<PnlSummary> {
  const { from, to } = rangeBounds(range, new Date());
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_pnl_summary", { p_from: from, p_to: to });
  if (error) throw new Error(`getPnlSummary: ${error.message}`);
  const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  return {
    revenue: num(r?.revenue),
    cost: num(r?.cost),
    gross_profit: num(r?.gross_profit),
    ar_collected: num(r?.ar_collected),
    ar_outstanding: num(r?.ar_outstanding),
    ap_outstanding: num(r?.ap_outstanding),
  };
}

export async function getCommodityPerformance(range: ReportRange): Promise<CommodityRow[]> {
  const { from, to } = rangeBounds(range, new Date());
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_by_commodity", { p_from: from, p_to: to });
  if (error) throw new Error(`getCommodityPerformance: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const revenue = num(r.revenue);
    const profit = num(r.profit);
    return { commodity: String(r.commodity), revenue, cost: num(r.cost), profit, margin: marginPct(profit, revenue) };
  });
}

export async function getLedgerFeed(range: ReportRange, limit = 20): Promise<LedgerRow[]> {
  const { from, to } = rangeBounds(range, new Date());
  const supabase = await createClient();
  let query = supabase
    .from("invoices")
    .select("id, invoice_no, type, amount, currency, due_date, status, clients(name)")
    .order("due_date", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (from) query = query.gte("due_date", from);
  if (to) query = query.lte("due_date", to);

  const { data } = await query;
  type Row = {
    id: string; invoice_no: string; type: "receivable" | "payable"; amount: unknown;
    currency: string; due_date: string | null; status: string; clients: { name: string } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    invoice_no: r.invoice_no,
    type: r.type,
    client: r.clients?.name ?? null,
    amount: num(r.amount),
    currency: r.currency,
    due_date: r.due_date,
    status: r.status,
  }));
}
