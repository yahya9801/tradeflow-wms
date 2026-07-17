import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

let failed = 0;
function check(name: string, pass: boolean, detail = "") {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!pass) failed++;
}
const approx = (a: number, b: number) => Math.abs(a - b) < 0.01;

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

  // --- Hand-check one commodity's margin against raw invoices (All Time) ---
  const { data: byCom } = await owner.rpc("report_by_commodity", { p_from: null, p_to: null });
  const target = (byCom ?? []).find((r: { commodity: string }) => r.commodity !== "Unattributed");
  check("report_by_commodity returns commodities", !!target, target?.commodity);

  // Recompute revenue/cost for that commodity from raw invoices joined via lots.
  // supabase-js infers the embedded relation as an array; normalise either shape.
  const { data: lots } = await owner.from("lots").select("id, commodities!inner(name)");
  type LotRow = { id: string; commodities: { name: string } | { name: string }[] };
  const nameOf = (c: LotRow["commodities"]) => (Array.isArray(c) ? c[0]?.name : c?.name);
  const lotIds = new Set(
    ((lots ?? []) as unknown as LotRow[]).filter((l) => nameOf(l.commodities) === target.commodity).map((l) => l.id),
  );
  const { data: inv } = await owner.from("invoices").select("type, amount, lot_id");
  let rev = 0, cost = 0;
  for (const i of inv ?? []) {
    if (i.lot_id && lotIds.has(i.lot_id)) {
      if (i.type === "receivable") rev += Number(i.amount);
      else cost += Number(i.amount);
    }
  }
  check("commodity revenue matches raw invoices", approx(Number(target.revenue), rev), `${target.revenue} vs ${rev}`);
  check("commodity cost matches raw invoices", approx(Number(target.cost), cost), `${target.cost} vs ${cost}`);
  check("commodity profit = revenue - cost", approx(Number(target.profit), rev - cost));

  // --- Summary revenue (All Time) = sum of all receivable amounts ---
  const { data: sumRows } = await owner.rpc("report_pnl_summary", { p_from: null, p_to: null });
  const summary = Array.isArray(sumRows) ? sumRows[0] : sumRows;
  const { data: allInv } = await owner.from("invoices").select("type, amount");
  const totalAr = (allInv ?? []).filter((i) => i.type === "receivable").reduce((s, i) => s + Number(i.amount), 0);
  check("summary revenue = sum of receivable amounts", approx(Number(summary.revenue), totalAr), `${summary.revenue} vs ${totalAr}`);

  // --- A bounded range filters (90d revenue <= all-time revenue) ---
  const to = new Date().toISOString().slice(0, 10);
  const from = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
  const { data: rows90 } = await owner.rpc("report_pnl_summary", { p_from: from, p_to: to });
  const s90 = Array.isArray(rows90) ? rows90[0] : rows90;
  check("90-day revenue ≤ all-time revenue", Number(s90.revenue) <= Number(summary.revenue) + 0.01, `${s90.revenue} ≤ ${summary.revenue}`);

  // --- Management is masked (RLS zeroes the report) ---
  const { data: mRows } = await mgmt.rpc("report_pnl_summary", { p_from: null, p_to: null });
  const m = Array.isArray(mRows) ? mRows[0] : mRows;
  check("Management report revenue is zero (RLS)", Number(m?.revenue ?? 0) === 0, `${m?.revenue}`);

  console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
