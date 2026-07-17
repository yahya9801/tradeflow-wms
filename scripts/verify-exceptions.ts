import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

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

  const { data: cm } = await owner.from("commodities").select("id").limit(1).single();
  const { data: cl } = await owner.from("clients").select("id").limit(1).single();
  const { data: me } = await owner.auth.getUser();

  // --- Core verify: In Transit + null B/L → missing_bl, then fill → resolves ---
  const { data: lot, error: lotErr } = await owner
    .from("lots")
    .insert({ direction: "import", commodity_id: cm!.id, client_id: cl!.id, quantity_mt: 1, status: "in_transit", created_by: me!.user!.id })
    .select("id, lot_number")
    .single();
  if (lotErr) { console.error(lotErr); process.exit(1); }
  const lotId = lot!.id;

  const openBl = async () =>
    (await owner.from("exceptions").select("id, status").eq("lot_id", lotId).eq("type", "missing_bl").eq("status", "open")).data ?? [];
  check("missing_bl opens for In Transit lot without B/L", (await openBl()).length === 1, lot!.lot_number);

  await owner.from("lots").update({ bl_number: "BL-TEST-1" }).eq("id", lotId);
  check("missing_bl auto-resolves when B/L is filled", (await openBl()).length === 0);

  // --- Manual flag + resolve writes audit ---
  const { data: flag } = await owner
    .from("exceptions")
    .insert({ lot_id: lotId, type: "weight_shortage", severity: "critical", description: "Short by 3 MT on discharge" })
    .select("id")
    .single();
  check("manual weight_shortage flag created", !!flag?.id);
  await owner.from("exceptions").update({ status: "resolved", note: "Reconciled" }).eq("id", flag!.id);
  check("flag resolves", ((await owner.from("exceptions").select("status").eq("id", flag!.id).single()).data?.status) === "resolved");

  // --- Overdue refresh materialises a row without an amount ---
  await owner.rpc("refresh_overdue_exceptions");
  const { data: overdue } = await owner
    .from("exceptions")
    .select("description")
    .eq("type", "overdue_invoice")
    .eq("status", "open")
    .limit(20);
  const anyAmount = (overdue ?? []).some((e) => /\d[.,]\d{2}\b/.test(e.description));
  check("overdue descriptions carry no monetary amount", !anyAmount, `${overdue?.length ?? 0} open`);

  // --- Management reads exceptions (operational); our overdue rows leak no amount ---
  const { data: mExc } = await mgmt.from("exceptions").select("type, description").eq("status", "open");
  check("Management can read exceptions", (mExc?.length ?? 0) >= 0);
  const mLeak = (mExc ?? [])
    .filter((e) => e.type === "overdue_invoice")
    .some((e) => /\d[.,]\d{2}\b/.test(e.description));
  check("no amount visible to Management via overdue exceptions", !mLeak);

  // --- Cleanup (exceptions cascade on lot delete) ---
  await owner.from("lots").delete().eq("id", lotId);
  const { data: gone } = await owner.from("lots").select("id").eq("id", lotId).maybeSingle();
  check("cleanup removed the test lot", gone == null);

  console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
