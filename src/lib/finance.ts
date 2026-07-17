import "server-only";

import { createClient } from "@/lib/supabase/server";
import { agingBuckets, isOverdue, type AgingBucket, type InvoiceStatus } from "@/lib/finance-math";

const num = (v: unknown): number => Number(v ?? 0);

export type InvoiceType = "receivable" | "payable";

export type InvoiceRow = {
  id: string;
  invoice_no: string;
  type: InvoiceType;
  status: InvoiceStatus;
  currency: string;
  amount: number;
  amount_paid: number;
  outstanding: number;
  due_date: string | null;
  overdue: boolean;
  client_id: string;
  client_name: string | null;
  lot_id: string | null;
  lot_number: string | null;
  description: string | null;
};

export type PaymentRow = {
  id: string;
  amount: number;
  paid_on: string;
  method: string | null;
  note: string | null;
};

export type CurrencyPosition = {
  currency: string;
  ar_outstanding: number;
  ap_outstanding: number;
  net: number;
};

export type AccountsSummary = {
  positions: CurrencyPosition[];
  ar_count: number;
  ap_count: number;
  overdue_count: number;
};

const SELECT =
  "id, invoice_no, type, status, currency, amount, amount_paid, due_date, description, client_id, lot_id, clients(name), lots(lot_number)";

type RawInvoice = {
  id: string; invoice_no: string; type: InvoiceType; status: InvoiceStatus;
  currency: string; amount: unknown; amount_paid: unknown; due_date: string | null;
  description: string | null; client_id: string; lot_id: string | null;
  clients: { name: string } | null; lots: { lot_number: string } | null;
};

function toRow(r: RawInvoice, today: Date): InvoiceRow {
  const amount = num(r.amount);
  const amount_paid = num(r.amount_paid);
  return {
    id: r.id,
    invoice_no: r.invoice_no,
    type: r.type,
    status: r.status,
    currency: r.currency,
    amount,
    amount_paid,
    outstanding: Math.max(amount - amount_paid, 0),
    due_date: r.due_date,
    overdue: isOverdue(r.due_date, r.status, today),
    client_id: r.client_id,
    client_name: r.clients?.name ?? null,
    lot_id: r.lot_id,
    lot_number: r.lots?.lot_number ?? null,
    description: r.description,
  };
}

/** RLS returns nothing for Management — the mask is the database. */
export async function listInvoices(opts: {
  type?: InvoiceType; status?: string; q?: string;
} = {}): Promise<InvoiceRow[]> {
  const supabase = await createClient();
  let query = supabase.from("invoices").select(SELECT).order("invoice_no", { ascending: false });
  if (opts.type) query = query.eq("type", opts.type);
  if (opts.status && opts.status !== "all") query = query.eq("status", opts.status);
  if (opts.q?.trim()) query = query.ilike("invoice_no", `%${opts.q.trim()}%`);

  const { data, error } = await query;
  if (error) throw new Error(`listInvoices: ${error.message}`);
  const today = new Date();
  return ((data ?? []) as unknown as RawInvoice[]).map((r) => toRow(r, today));
}

export async function getInvoice(id: string): Promise<InvoiceRow | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("invoices").select(SELECT).eq("id", id).maybeSingle();
  return data ? toRow(data as unknown as RawInvoice, new Date()) : null;
}

export async function getPayments(invoiceId: string): Promise<PaymentRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("payments")
    .select("id, amount, paid_on, method, note")
    .eq("invoice_id", invoiceId)
    .order("paid_on", { ascending: false });
  return ((data ?? []) as { id: string; amount: unknown; paid_on: string; method: string | null; note: string | null }[])
    .map((p) => ({ id: p.id, amount: num(p.amount), paid_on: p.paid_on, method: p.method, note: p.note }));
}

export async function getAccountsSummary(): Promise<AccountsSummary> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("invoices")
    .select("type, status, currency, amount, amount_paid, due_date");

  const positions = new Map<string, CurrencyPosition>();
  let ar_count = 0;
  let ap_count = 0;
  let overdue_count = 0;
  const today = new Date();

  for (const r of (data ?? []) as {
    type: InvoiceType; status: InvoiceStatus; currency: string;
    amount: unknown; amount_paid: unknown; due_date: string | null;
  }[]) {
    const outstanding = Math.max(num(r.amount) - num(r.amount_paid), 0);
    const p = positions.get(r.currency) ?? { currency: r.currency, ar_outstanding: 0, ap_outstanding: 0, net: 0 };
    if (r.type === "receivable") { p.ar_outstanding += outstanding; ar_count++; }
    else { p.ap_outstanding += outstanding; ap_count++; }
    p.net = p.ar_outstanding - p.ap_outstanding;
    positions.set(r.currency, p);
    if (isOverdue(r.due_date, r.status, today)) overdue_count++;
  }

  return {
    positions: [...positions.values()].sort((a, b) => a.currency.localeCompare(b.currency)),
    ar_count,
    ap_count,
    overdue_count,
  };
}

export async function getAging(type: InvoiceType): Promise<AgingBucket[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("invoices")
    .select("amount, amount_paid, due_date")
    .eq("type", type)
    .neq("status", "paid");

  const items = ((data ?? []) as { amount: unknown; amount_paid: unknown; due_date: string | null }[])
    .map((r) => ({ due_date: r.due_date, outstanding: Math.max(num(r.amount) - num(r.amount_paid), 0) }))
    .filter((r) => r.outstanding > 0);
  return agingBuckets(items, new Date());
}

export type Option = { id: string; label: string };

export async function listClientOptions(): Promise<Option[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("clients").select("id, name").order("name");
  return ((data ?? []) as { id: string; name: string }[]).map((c) => ({ id: c.id, label: c.name }));
}

export async function listLotOptions(): Promise<Option[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("lots").select("id, lot_number").order("lot_number", { ascending: false });
  return ((data ?? []) as { id: string; lot_number: string }[]).map((l) => ({ id: l.id, label: l.lot_number }));
}
