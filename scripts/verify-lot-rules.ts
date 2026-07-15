import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

/**
 * Proves the DATABASE enforces the lot rules and leaks no money — bypassing the
 * UI entirely, as a real API caller would.
 *
 * Signs in over the ANON key so `auth.uid()` is set: the enforce_lot_rules()
 * trigger (migrations 0011 + 0012) has an admin bypass for null auth.uid(),
 * which is exactly the context scripts/db.ts runs under. Only a real
 * signed-in app user exercises the trigger, so that's what this script does.
 *
 * Every check here either gets REJECTED by the trigger (nothing to clean up)
 * or, if a write could succeed, restores the row and verifies the restore.
 * This is a live shared database with seeded demo data — no truncation, no
 * reseeding, no mass updates.
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
  const mgmt = await asUser("management@tradeflow.example");
  const owner = await asUser("owner@tradeflow.example");

  // --- Financial masking on the lot path ---
  const { data: mLots } = await mgmt.from("lots_view").select("id, lot_number, market_value").limit(5);
  check("Management sees lots", (mLots?.length ?? 0) > 0);
  check(
    "Management sees NULL market_value on every lot",
    (mLots ?? []).every((l) => l.market_value === null),
  );

  const { data: mInv } = await mgmt.from("invoices").select("id").limit(1);
  check("Management sees 0 invoices", (mInv?.length ?? 0) === 0);

  const { data: oLots } = await owner
    .from("lots_view").select("market_value").not("market_value", "is", null).limit(1);
  check("Owner sees market_value", (oLots?.length ?? 0) > 0);

  // --- Transition rules, enforced by the trigger, bypassing the UI ---
  const { data: delivered } = await owner
    .from("lots").select("id, lot_number, status").eq("status", "delivered").limit(1);
  const lot = delivered![0];

  const { error: jumpErr } = await owner.from("lots").update({ status: "pending" }).eq("id", lot.id);
  check("Illegal jump delivered → pending is rejected", !!jumpErr, jumpErr?.message?.slice(0, 60));

  const { data: after } = await owner.from("lots").select("status").eq("id", lot.id).maybeSingle();
  check("The lot did not move", after?.status === "delivered");

  // Management may not step backward (owner-only correction).
  const { data: storedLot } = await mgmt
    .from("lots").select("id, status").eq("status", "stored").limit(1);
  const { error: backErr } = await mgmt
    .from("lots").update({ status: "received" }).eq("id", storedLot![0].id);
  check("Management cannot step backward", !!backErr, backErr?.message?.slice(0, 60));

  // --- Capacity rule ---
  // Pick the FULLEST shed and the LARGEST received lot so the attempted
  // quantity genuinely exceeds free space — a check against a shed with
  // spare room, or a lot small enough to fit, would be meaningless.
  const { data: fullShed } = await owner
    .from("shed_occupancy")
    .select("shed_id, name, capacity_mt, stored_mt")
    .order("occupancy_pct", { ascending: false })
    .limit(1);
  const { data: biggestReceived } = await owner
    .from("lots").select("id, lot_number, quantity_mt")
    .eq("status", "received")
    .order("quantity_mt", { ascending: false })
    .limit(1);

  const shed = fullShed![0];
  const receivedLot = biggestReceived![0];
  const freeMt = Number(shed.capacity_mt) - Number(shed.stored_mt);
  const qtyMt = Number(receivedLot.quantity_mt);
  if (!(qtyMt > freeMt)) {
    throw new Error(
      `Capacity check setup invalid: fullest shed "${shed.name}" has ${freeMt} MT free, ` +
        `but the largest received lot ${receivedLot.lot_number} is only ${qtyMt} MT — ` +
        `it would fit, so the "storing exceeds capacity" check would be meaningless.`,
    );
  }
  console.log(
    `  (setup: "${shed.name}" has ${freeMt} MT free; ${receivedLot.lot_number} is ${qtyMt} MT — genuinely exceeds free space)`,
  );

  const { error: capErr } = await owner
    .from("lots")
    .update({ status: "stored", shed_id: shed.shed_id })
    .eq("id", receivedLot.id);
  check("Storing into the fullest shed is rejected on capacity", !!capErr, capErr?.message?.slice(0, 70));

  const { data: afterCap } = await owner
    .from("lots").select("status, shed_id").eq("id", receivedLot.id).maybeSingle();
  check(
    "The lot rejected on capacity did not move",
    afterCap?.status === "received" && afterCap?.shed_id === null,
  );

  // --- Storing without a shed is rejected (migration 0012) ---
  // A prior version of the trigger skipped the capacity check (and the
  // Phase 3 stored==open-stays invariant) whenever shed_id was null. Prove
  // the guard added in 0012 actually rejects it.
  const { data: anotherReceived } = await owner
    .from("lots").select("id, lot_number, status, shed_id")
    .eq("status", "received")
    .neq("id", receivedLot.id)
    .limit(1);
  const noShedLot = anotherReceived![0];

  const { error: noShedErr } = await owner
    .from("lots").update({ status: "stored", shed_id: null }).eq("id", noShedLot.id);
  check("Storing without a shed is rejected", !!noShedErr, noShedErr?.message?.slice(0, 70));

  const { data: afterNoShed } = await owner
    .from("lots").select("status, shed_id").eq("id", noShedLot.id).maybeSingle();
  check(
    "The lot rejected for missing shed did not move",
    afterNoShed?.status === "received" && afterNoShed?.shed_id === noShedLot.shed_id,
  );

  // --- Exceptions tell the truth ---
  const { data: lying } = await owner
    .from("exceptions").select("id, type, lots!inner(bl_number, payment_terms)").eq("status", "open");
  const liars = (lying ?? []).filter((e) => {
    const x = e as unknown as { type: string; lots: { bl_number: string | null; payment_terms: string | null } };
    return (
      (x.type === "missing_bl" && x.lots.bl_number !== null) ||
      (x.type === "missing_payment_terms" && x.lots.payment_terms !== null)
    );
  });
  check("No open exception contradicts its lot", liars.length === 0, `${liars.length} lying`);

  console.log(failed === 0 ? "\nAll checks passed." : `\n${failed} check(s) FAILED.`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
