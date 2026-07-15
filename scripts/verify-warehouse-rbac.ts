import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

/**
 * Proves the database — not the UI — is what stops a Management user from
 * mutating facilities. Hidden buttons are cosmetic; this bypasses them.
 */
let failed = 0;
function check(name: string, pass: boolean) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}`);
  if (!pass) failed++;
}

async function main() {
  const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const { error: loginErr } = await c.auth.signInWithPassword({
    email: "management@tradeflow.example",
    password: "TradeFlow!2026",
  });
  if (loginErr) throw new Error(`login: ${loginErr.message}`);

  // INSERT violates the WITH CHECK clause, so it errors outright.
  const { error: whInsert } = await c.from("warehouses").insert({ name: "Hack Depot", capacity_mt: 1 });
  check("Management insert into warehouses errors", !!whInsert);

  const { data: sheds } = await c.from("sheds").select("id, name").limit(1);
  const shedId = sheds![0].id;

  // UPDATE/DELETE do NOT error under RLS — the rows are simply invisible, so the
  // statement matches nothing. The security property is "zero rows affected",
  // not "throws". (This is why the Server Actions also gate on
  // requireCapability: RLS alone would report a misleading success.)
  const { data: updated } = await c.from("sheds").update({ name: "Hacked" }).eq("id", shedId).select();
  check("Management update of a shed affects 0 rows", (updated?.length ?? 0) === 0);

  const { data: deleted } = await c.from("sheds").delete().eq("id", shedId).select();
  check("Management delete of a shed affects 0 rows", (deleted?.length ?? 0) === 0);

  // Reads must still work — Management runs operations.
  const { data: occ } = await c.from("warehouse_occupancy").select("name, occupancy_pct").limit(1);
  check("Management can read warehouse occupancy", (occ?.length ?? 0) > 0);

  const { data: mv } = await c.from("lot_movements").select("id").limit(1);
  check("Management can read shed history", (mv?.length ?? 0) > 0);

  // The shed must be untouched by the attempts above.
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
  const { data: after } = await admin.from("sheds").select("name").eq("id", shedId).maybeSingle();
  check("Shed survived the attempted delete/update", after?.name === sheds![0].name);

  console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
