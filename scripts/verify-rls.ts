import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const SEED_PASSWORD = "TradeFlow!2026";

async function asUser(email: string) {
  const c = createClient(url, anon, { auth: { persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: SEED_PASSWORD });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return c;
}

let failed = 0;
function check(name: string, pass: boolean) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) failed++;
}

async function main() {
  // Seed one audit row (service role) so the owner-only read is a real test.
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  await admin.from("audit_log").insert({ action: "seed", entity_type: "system", entity_id: "verify", details: {} });

  const mgmt = await asUser("management@tradeflow.example");
  const owner = await asUser("owner@tradeflow.example");

  // --- Management: no financial data anywhere ---
  const { data: mInv } = await mgmt.from("invoices").select("id").limit(1);
  check("Management sees 0 invoices", (mInv?.length ?? 0) === 0);

  const { data: mComm } = await mgmt.from("commodities_view").select("market_price_per_mt").limit(1);
  check("Management sees NULL price in commodities_view", mComm != null && mComm[0]?.market_price_per_mt == null);

  const { data: mLot } = await mgmt.from("lots_view").select("market_value").limit(1);
  check("Management sees NULL market_value in lots_view", mLot != null && mLot[0]?.market_value == null);

  const { data: mAudit } = await mgmt.from("audit_log").select("seq").limit(1);
  check("Management sees 0 audit rows", (mAudit?.length ?? 0) === 0);

  // Management can still do operations (sees lots)
  const { data: mLots } = await mgmt.from("lots").select("id").limit(1);
  check("Management sees operational lots", (mLots?.length ?? 0) > 0);

  // --- Management write blocks ---
  const { data: aClient } = await owner.from("clients").select("id").limit(1);
  const { error: insErr } = await mgmt
    .from("invoices")
    .insert({ invoice_no: "INV-HACK-1", client_id: aClient![0].id, type: "receivable", amount: 1 });
  check("Management insert into invoices is blocked", !!insErr);

  const { error: delErr } = await mgmt.from("audit_log").delete().eq("action", "seed");
  check("Management delete on audit_log is blocked", !!delErr);

  // --- Owner: full financial visibility ---
  const { data: oInv } = await owner.from("invoices").select("id").limit(1);
  check("Owner sees invoices", (oInv?.length ?? 0) > 0);

  const { data: oComm } = await owner
    .from("commodities_view")
    .select("market_price_per_mt")
    .not("market_price_per_mt", "is", null)
    .limit(1);
  check("Owner sees price in commodities_view", (oComm?.length ?? 0) > 0);

  const { data: oAudit } = await owner.from("audit_log").select("seq").limit(1);
  check("Owner sees audit rows", (oAudit?.length ?? 0) > 0);

  console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
