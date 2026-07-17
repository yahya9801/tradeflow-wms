"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { invoiceSchema } from "@/lib/schemas/invoice";
import { paymentSchema } from "@/lib/schemas/payment";

export type InvoiceActionState = {
  error: string | null;
  fieldErrors?: Record<string, string>;
  ok?: boolean;
};

function zodFieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

const nz = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);
const f = (formData: FormData, key: string) => formData.get(key) ?? undefined;

function revalidateFinance(lotId?: string | null, clientId?: string | null) {
  revalidatePath("/accounts");
  if (lotId) revalidatePath(`/lots/${lotId}`);
  if (clientId) revalidatePath(`/clients/${clientId}`);
}

export async function saveInvoice(_prev: InvoiceActionState, formData: FormData): Promise<InvoiceActionState> {
  const gate = await requireCapability("manage_invoices");
  if (!gate.allowed) return { error: "Finance access required." };

  const parsed = invoiceSchema.safeParse({
    type: f(formData, "type"),
    client_id: f(formData, "client_id"),
    lot_id: f(formData, "lot_id"),
    currency: f(formData, "currency"),
    amount: f(formData, "amount"),
    due_date: f(formData, "due_date"),
    description: f(formData, "description"),
  });
  if (!parsed.success) return { error: null, fieldErrors: zodFieldErrors(parsed.error.issues) };

  const v = parsed.data;
  // invoice_no is omitted so the DB default (INV-YYYY-NNNNN) fires on insert.
  const row = {
    type: v.type,
    client_id: v.client_id,
    lot_id: nz(v.lot_id),
    currency: v.currency,
    amount: v.amount,
    due_date: nz(v.due_date),
    description: nz(v.description),
  };

  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();

  if (id) {
    const { data: before } = await supabase
      .from("invoices")
      .select("type, client_id, lot_id, currency, amount, due_date, description")
      .eq("id", id)
      .maybeSingle();
    const { error } = await supabase.from("invoices").update(row).eq("id", id);
    if (error) return { error: error.message };
    await writeAudit("update", "invoice", id, { before, after: row });
    revalidateFinance(row.lot_id, row.client_id);
  } else {
    const { data, error } = await supabase.from("invoices").insert(row).select("id").single();
    if (error) return { error: error.message };
    await writeAudit("create", "invoice", data.id, { after: row });
    revalidateFinance(row.lot_id, row.client_id);
  }

  return { error: null, ok: true };
}

export async function deleteInvoice(_prev: InvoiceActionState, formData: FormData): Promise<InvoiceActionState> {
  const gate = await requireCapability("manage_invoices");
  if (!gate.allowed) return { error: "Finance access required." };

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing invoice." };

  const supabase = await createClient();
  const { data: before } = await supabase
    .from("invoices")
    .select("invoice_no, type, client_id, lot_id, amount")
    .eq("id", id)
    .maybeSingle();

  // Payments cascade at the DB (on delete cascade).
  const { error } = await supabase.from("invoices").delete().eq("id", id);
  if (error) return { error: error.message };
  await writeAudit("delete", "invoice", id, { before });
  revalidateFinance(before?.lot_id, before?.client_id);
  return { error: null, ok: true };
}

export async function recordPayment(_prev: InvoiceActionState, formData: FormData): Promise<InvoiceActionState> {
  const gate = await requireCapability("manage_invoices");
  if (!gate.allowed) return { error: "Finance access required." };

  const parsed = paymentSchema.safeParse({
    invoice_id: f(formData, "invoice_id"),
    amount: f(formData, "amount"),
    paid_on: f(formData, "paid_on"),
    method: f(formData, "method"),
    note: f(formData, "note"),
  });
  if (!parsed.success) return { error: null, fieldErrors: zodFieldErrors(parsed.error.issues) };

  const v = parsed.data;
  const supabase = await createClient();

  // Server-side overpayment guard (the DB trigger is the backstop).
  const { data: inv } = await supabase
    .from("invoices")
    .select("amount, amount_paid, lot_id, client_id, currency")
    .eq("id", v.invoice_id)
    .maybeSingle();
  if (!inv) return { error: "Invoice not found." };
  const remaining = Math.max(Number(inv.amount) - Number(inv.amount_paid), 0);
  if (v.amount > remaining + 1e-9) {
    return { error: `Payment exceeds the remaining balance of ${inv.currency} ${remaining.toFixed(2)}.` };
  }

  const { data, error } = await supabase
    .from("payments")
    .insert({ invoice_id: v.invoice_id, amount: v.amount, paid_on: v.paid_on, method: nz(v.method), note: nz(v.note) })
    .select("id")
    .single();
  if (error) return { error: error.message };
  await writeAudit("create", "payment", data.id, { after: { invoice_id: v.invoice_id, amount: v.amount, paid_on: v.paid_on } });
  revalidateFinance(inv.lot_id as string | null, inv.client_id as string | null);
  return { error: null, ok: true };
}

export async function deletePayment(_prev: InvoiceActionState, formData: FormData): Promise<InvoiceActionState> {
  const gate = await requireCapability("manage_invoices");
  if (!gate.allowed) return { error: "Finance access required." };

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing payment." };

  const supabase = await createClient();
  const { data: before } = await supabase.from("payments").select("invoice_id, amount").eq("id", id).maybeSingle();
  const { error } = await supabase.from("payments").delete().eq("id", id);
  if (error) return { error: error.message };
  await writeAudit("delete", "payment", id, { before });
  revalidatePath("/accounts");
  return { error: null, ok: true };
}
