import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

/**
 * Proves, from the API (bypassing the UI): pipeline counts equal the lots
 * table, a Management session gets no client-invoice money, and a Management
 * client write is refused.
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

  // --- Pipeline counts equal the lots table, per direction+status ---
  for (const direction of ["import", "export"] as const) {
    const { data: lots } = await owner.from("lots_view").select("status").eq("direction", direction);
    const byStatus: Record<string, number> = {};
    for (const l of lots ?? []) byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;

    const { data: raw } = await owner.from("lots").select("status").eq("direction", direction);
    const rawByStatus: Record<string, number> = {};
    for (const l of raw ?? []) rawByStatus[l.status] = (rawByStatus[l.status] ?? 0) + 1;

    const match = JSON.stringify(byStatus) === JSON.stringify(rawByStatus);
    check(`${direction} pipeline counts match lots table`, match, JSON.stringify(byStatus));
  }

  // --- Management sees clients + operational volume, but no invoice money ---
  const { data: someClient } = await owner.from("invoices").select("client_id").limit(1);
  const clientId = someClient![0].client_id;

  const { data: mClient } = await mgmt.from("clients").select("id, name").eq("id", clientId).maybeSingle();
  check("Management can read a client profile", mClient != null, mClient?.name);

  const { data: mLots } = await mgmt.from("lots_view").select("quantity_mt, market_value").eq("client_id", clientId);
  check("Management sees the client's lots (volume)", (mLots?.length ?? 0) > 0);
  check("Management sees NULL market_value on those lots", (mLots ?? []).every((l) => l.market_value === null));

  const { data: mInv } = await mgmt.from("invoices").select("id").eq("client_id", clientId);
  check("Management sees 0 invoices for the client", (mInv?.length ?? 0) === 0);

  const { data: oInv } = await owner.from("invoices").select("id").eq("client_id", clientId);
  check("Owner sees the client's invoices", (oInv?.length ?? 0) > 0);

  // --- Management cannot write to the client directory (RLS) ---
  const { error: insErr } = await mgmt.from("clients").insert({ name: "Hack Client", type: "buyer" });
  check("Management insert into clients errors", !!insErr);

  const { data: updated } = await mgmt.from("clients").update({ name: "Hacked" }).eq("id", clientId).select();
  check("Management update of a client affects 0 rows", (updated?.length ?? 0) === 0);

  console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
