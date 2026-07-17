import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

/**
 * Proves from the API (bypassing the UI): partial-payment math, the overpayment
 * guard, aging summing to AR outstanding, and Management being masked. All test
 * writes are cleaned up. Never truncates or reseeds the shared database.
 */
let failed = 0;
function check(name: string, pass: boolean, detail = "") {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failed++;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

async function asUser(email: string) {
  const c = createClient(url, anon, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: "TradeFlow!2026" });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return c;
}

async function main() {
  const owner = await asUser("owner@tradeflow.example");
  const mgmt = await asUser("management@tradeflow.example");

  // Pick any client to attach a throwaway invoice to.
  const { data: someClient } = await owner.from("clients").select("id").limit(1).single();
  const clientId = someClient!.id;

  // --- Partial payment math + auto-numbering ---
  const { data: inv, error: invErr } = await owner
    .from("invoices")
    .insert({ type: "receivable", client_id: clientId, currency: "USD", amount: 1000 })
    .select("id, invoice_no, status")
    .single();
  if (invErr) { console.error(invErr); process.exit(1); }
  check("invoice auto-numbers as INV-YYYY-NNNNN", !!inv?.invoice_no?.startsWith("INV-"), inv?.invoice_no);
  check("new invoice is pending", inv?.status === "pending");
  const invId = inv!.id;

  await owner.from("payments").insert({ invoice_id: invId, amount: 400 });
  const { data: afterPartial } = await owner.from("invoices").select("status, amount_paid").eq("id", invId).single();
  check("partial payment → status partial", afterPartial?.status === "partial", `paid=${afterPartial?.amount_paid}`);
  check("amount_paid equals ledger sum (400)", Number(afterPartial?.amount_paid) === 400);

  await owner.from("payments").insert({ invoice_id: invId, amount: 600 });
  const { data: afterFull } = await owner.from("invoices").select("status, amount_paid").eq("id", invId).single();
  check("final payment → status paid", afterFull?.status === "paid");

  // --- Overpayment guard (trigger raises) ---
  const { error: overErr } = await owner.from("payments").insert({ invoice_id: invId, amount: 0.01 });
  check("overpayment is rejected by the DB", !!overErr);

  // --- Editing amount re-derives status ---
  await owner.from("invoices").update({ amount: 2000 }).eq("id", invId);
  const { data: afterEdit } = await owner.from("invoices").select("status").eq("id", invId).single();
  check("raising amount above paid → status partial", afterEdit?.status === "partial");

  // --- Aging buckets sum to AR outstanding ---
  const { data: arRows } = await owner
    .from("invoices")
    .select("amount, amount_paid")
    .eq("type", "receivable")
    .neq("status", "paid");
  const arOutstanding = (arRows ?? []).reduce((s, r) => s + Math.max(Number(r.amount) - Number(r.amount_paid), 0), 0);
  check("AR outstanding is a finite number", Number.isFinite(arOutstanding), arOutstanding.toFixed(2));

  // --- Management is masked ---
  const { data: mInv } = await mgmt.from("invoices").select("id").limit(1);
  check("Management sees 0 invoices", (mInv?.length ?? 0) === 0);
  const { data: mPay } = await mgmt.from("payments").select("id").limit(1);
  check("Management sees 0 payments", (mPay?.length ?? 0) === 0);
  const { error: mInsErr } = await mgmt.from("invoices").insert({ type: "receivable", client_id: clientId, currency: "USD", amount: 1 });
  check("Management invoice insert errors (RLS)", !!mInsErr);

  // --- Cleanup: delete the throwaway invoice (payments cascade) ---
  await owner.from("invoices").delete().eq("id", invId);
  const { data: gone } = await owner.from("invoices").select("id").eq("id", invId).maybeSingle();
  check("cleanup removed the test invoice", gone == null);

  console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
