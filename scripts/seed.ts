import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { faker } from "@faker-js/faker";
import { COMMODITIES, COUNTRIES, CURRENCIES, LOT_STATUSES } from "./seed-data";

faker.seed(42); // deterministic

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
if (!url || !serviceKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

const db = createClient(url, serviceKey, { auth: { persistSession: false } });

const SEED_PASSWORD = "TradeFlow!2026";

async function ensureUser(email: string, full_name: string, role: "owner" | "management") {
  const { data: list } = await db.auth.admin.listUsers();
  let user = list.users.find((u) => u.email === email);
  if (!user) {
    const { data, error } = await db.auth.admin.createUser({
      email,
      password: SEED_PASSWORD,
      email_confirm: true,
    });
    if (error) throw error;
    user = data.user;
  }
  const { error: pErr } = await db.from("profiles").upsert({ id: user!.id, full_name, role });
  if (pErr) throw pErr;
  return user!.id;
}

function mkClient(type: "supplier" | "buyer") {
  const country = faker.helpers.arrayElement(COUNTRIES);
  return {
    name: faker.company.name(),
    type,
    country,
    contact_name: faker.person.fullName(),
    email: faker.internet.email().toLowerCase(),
    phone: faker.phone.number(),
    currency: faker.helpers.arrayElement(CURRENCIES),
  };
}

async function wipe() {
  // FK-safe order; uuid tables match-all via "id is not null"
  for (const t of ["invoices", "exceptions", "lots", "sheds", "warehouses", "commodities", "clients"]) {
    const { error } = await db.from(t).delete().not("id", "is", null);
    if (error) throw new Error(`wipe ${t}: ${error.message}`);
  }
  await db.from("settings").delete().neq("key", "");
  await db.from("companies_profile").delete().not("id", "is", null);
}

async function main() {
  // 1. users
  const ownerId = await ensureUser("owner@tradeflow.example", "Ava Owner", "owner");
  await ensureUser("management@tradeflow.example", "Marcus Manager", "management");

  // 2. clean business tables
  await wipe();

  // 3. company + settings
  await db.from("companies_profile").insert({
    id: true,
    name: "Meridian Commodities Ltd",
    address: "Unit 4, Harbour Trade Park",
    port: "Port of Karachi",
    fiscal_year_start: "2026-01-01",
    registrations: { tax_id: "TX-99120", import_license: "IMP-4471" },
  });
  await db.from("settings").insert([
    { key: "default_currency", value: "USD" },
    { key: "date_format", value: "DD MMM YYYY" },
    { key: "low_stock_threshold_pct", value: 80 },
    { key: "alerts", value: { overdue_invoices: true, over_capacity: true, missing_bl: true } },
  ]);

  // 4. warehouses + sheds
  const { data: whRows, error: whErr } = await db
    .from("warehouses")
    .insert([
      { name: "Harbour Terminal Warehouse", address: "Dock Road, Zone A", capacity_mt: 12000 },
      { name: "Inland Distribution Depot", address: "Ring Road, Sector 9", capacity_mt: 8000 },
    ])
    .select();
  if (whErr) throw whErr;
  // Sheds allocate ~90% of the facility's rated capacity; the remainder is
  // unallocated space (aisles, handling, staging), which the UI shows.
  const shedRows: Array<{ warehouse_id: string; name: string; capacity_mt: number }> = [];
  for (const wh of whRows!) {
    const n = faker.number.int({ min: 3, max: 4 });
    const base = Math.floor((Number(wh.capacity_mt) * 0.9) / n);
    for (let i = 1; i <= n; i++) {
      shedRows.push({
        warehouse_id: wh.id,
        name: `Shed ${String.fromCharCode(64 + i)}`,
        capacity_mt: base + faker.number.int({ min: -200, max: 200 }),
      });
    }
  }
  const { data: sheds } = await db.from("sheds").insert(shedRows).select();

  // 5. commodities
  const { data: commodities } = await db.from("commodities").insert(COMMODITIES.map((c) => ({ ...c }))).select();

  // 6. clients: 30 suppliers, 50 buyers
  const clients = [
    ...Array.from({ length: 30 }, () => mkClient("supplier")),
    ...Array.from({ length: 50 }, () => mkClient("buyer")),
  ];
  const { data: clientRows } = await db.from("clients").insert(clients).select();
  const suppliers = clientRows!.filter((c) => c.type === "supplier");
  const buyers = clientRows!.filter((c) => c.type === "buyer");

  // 7. ~100 lots across all statuses/directions
  //
  // Storage is capacity-aware: a lot is only placed in a shed that actually has
  // room for it, so a shed can never hold more than it physically can. A lot
  // that fits nowhere stays 'received' — arrived at the facility, awaiting
  // storage — which is exactly what would happen on a full site.
  const shedLoad = new Map<string, number>(sheds!.map((s) => [s.id, 0]));
  const shedCap = new Map<string, number>(sheds!.map((s) => [s.id, Number(s.capacity_mt)]));

  function placeLot(quantity: number) {
    const fitting = sheds!.filter((s) => shedLoad.get(s.id)! + quantity <= shedCap.get(s.id)!);
    if (fitting.length === 0) return null;
    const shed = faker.helpers.arrayElement(fitting);
    shedLoad.set(shed.id, shedLoad.get(shed.id)! + quantity);
    return shed;
  }

  const lots = Array.from({ length: 100 }, (_, i) => {
    const direction = faker.helpers.arrayElement(["import", "export"] as const);
    let status: (typeof LOT_STATUSES)[number] = LOT_STATUSES[i % LOT_STATUSES.length];
    const commodity = faker.helpers.arrayElement(commodities!);
    const counterparty =
      direction === "import" ? faker.helpers.arrayElement(suppliers) : faker.helpers.arrayElement(buyers);
    const quantity_mt = faker.number.int({ min: 100, max: 1500 });

    const shed = status === "stored" ? placeLot(quantity_mt) : null;
    if (status === "stored" && !shed) status = "received"; // no room anywhere

    return {
      direction,
      commodity_id: commodity.id,
      client_id: counterparty.id,
      quantity_mt,
      warehouse_id: shed ? shed.warehouse_id : faker.helpers.arrayElement(whRows!).id,
      shed_id: shed?.id ?? null,
      status,
      origin_country: direction === "import" ? counterparty.country : "Home Port",
      destination_country: direction === "export" ? counterparty.country : "Home Port",
      vessel_name: `MV ${faker.word.noun()} ${faker.number.int({ min: 1, max: 99 })}`,
      bl_number: status === "pending" ? null : `BL-${faker.string.alphanumeric(8).toUpperCase()}`,
      export_ref: direction === "export" ? `EXP-${faker.string.numeric(6)}` : null,
      payment_terms: faker.helpers.arrayElement(["LC", "TT", "CAD", "DA"] as const),
      eta: faker.date.soon({ days: 40 }).toISOString().slice(0, 10),
      arrival_date: ["received", "stored", "dispatched", "delivered"].includes(status)
        ? faker.date.recent({ days: 30 }).toISOString().slice(0, 10)
        : null,
      dispatch_date: ["dispatched", "delivered"].includes(status)
        ? faker.date.recent({ days: 10 }).toISOString().slice(0, 10)
        : null,
      notes: faker.helpers.arrayElement(["Priority shipment", "Standard handling", "Fumigation required", "Customs cleared"]),
      created_by: ownerId,
    };
  });
  const { data: lotRows, error: lotErr } = await db.from("lots").insert(lots).select();
  if (lotErr) throw lotErr;

  // 7b. Shed stays (lot_movements).
  //
  // The sync trigger already opened a stay for every stored lot at now();
  // backdate those to the lot's arrival. Dispatched/delivered lots left storage
  // before this table existed, so their history is SYNTHESIZED — the shed they
  // actually occupied was never recorded. Each synthesized stay is confined to
  // a shed of the lot's own warehouse, so a lot never appears in the history of
  // a warehouse it was never associated with.
  const shedsByWarehouse = new Map<string, typeof sheds>();
  for (const shed of sheds!) {
    const list = shedsByWarehouse.get(shed.warehouse_id) ?? [];
    list.push(shed);
    shedsByWarehouse.set(shed.warehouse_id, list as typeof sheds);
  }

  for (const lot of lotRows!.filter((l) => l.status === "stored" && l.arrival_date)) {
    const { error } = await db
      .from("lot_movements")
      .update({ placed_at: new Date(lot.arrival_date).toISOString() })
      .eq("lot_id", lot.id)
      .is("removed_at", null);
    if (error) throw new Error(`backdate stay ${lot.lot_number}: ${error.message}`);
  }

  const closedStays = lotRows!
    .filter((l) => ["dispatched", "delivered"].includes(l.status))
    .map((lot) => {
      const candidates = shedsByWarehouse.get(lot.warehouse_id) ?? sheds!;
      const shed = faker.helpers.arrayElement(candidates!);
      const removed = lot.dispatch_date ? new Date(lot.dispatch_date) : faker.date.recent({ days: 10 });
      const placed = lot.arrival_date ? new Date(lot.arrival_date) : faker.date.recent({ days: 40 });
      // Guard the check constraint: placed_at must not be after removed_at.
      const placedAt = placed <= removed ? placed : new Date(removed.getTime() - 86_400_000 * 7);
      return {
        lot_id: lot.id,
        shed_id: shed.id,
        placed_at: placedAt.toISOString(),
        removed_at: removed.toISOString(),
      };
    });
  const { error: mvErr } = await db.from("lot_movements").insert(closedStays);
  if (mvErr) throw mvErr;

  // 8. invoices AR + AP (≈70% of lots)
  let seqNo = 1000;
  const invoices = lotRows!
    .filter(() => faker.number.float() < 0.7)
    .map((lot) => {
      const commodity = commodities!.find((c) => c.id === lot.commodity_id)!;
      const amount = Number((lot.quantity_mt * Number(commodity.market_price_per_mt)).toFixed(2));
      const type = lot.direction === "export" ? "receivable" : "payable";
      const status = faker.helpers.weightedArrayElement([
        { value: "pending", weight: 4 },
        { value: "partial", weight: 3 },
        { value: "paid", weight: 3 },
      ]);
      const amount_paid = status === "paid" ? amount : status === "partial" ? Number((amount * 0.5).toFixed(2)) : 0;
      const overdue = faker.number.float() < 0.25;
      return {
        invoice_no: `INV-${type === "receivable" ? "AR" : "AP"}-${seqNo++}`,
        lot_id: lot.id,
        client_id: lot.client_id,
        type,
        status,
        currency: "USD",
        amount,
        amount_paid,
        due_date: (overdue ? faker.date.recent({ days: 40 }) : faker.date.soon({ days: 40 })).toISOString().slice(0, 10),
        description: `${type === "receivable" ? "Sale" : "Purchase"} — ${lot.lot_number}`,
      };
    });
  const { error: invErr } = await db.from("invoices").insert(invoices);
  if (invErr) throw invErr;

  // 9. Open exceptions.
  //
  // Field-backed exceptions must be TRUE: the Phase 1 seed stamped types onto
  // random lots without checking, so "missing_bl" sat on lots that had a B/L —
  // exactly the demo bug this project exists to fix. Here we create the real
  // violation first, then flag it, so "resolve = fill the field" is a genuine
  // flow. weight_shortage/compliance_block are human-raised claims that aren't
  // derivable from field state, so they stay as plain records.
  const exceptions: Array<Record<string, unknown>> = [];

  const inTransit = lotRows!.filter((l) => l.status === "in_transit").slice(0, 2);
  for (const lot of inTransit) {
    const { error } = await db.from("lots").update({ bl_number: null }).eq("id", lot.id);
    if (error) throw new Error(`clear bl ${lot.lot_number}: ${error.message}`);
    exceptions.push({
      lot_id: lot.id,
      type: "missing_bl",
      severity: "warning",
      description: "Bill of Lading not recorded for a shipment already in transit.",
      status: "open",
    });
  }

  const exportsNoTerms = lotRows!.filter((l) => l.direction === "export").slice(0, 2);
  for (const lot of exportsNoTerms) {
    const { error } = await db.from("lots").update({ payment_terms: null }).eq("id", lot.id);
    if (error) throw new Error(`clear terms ${lot.lot_number}: ${error.message}`);
    exceptions.push({
      lot_id: lot.id,
      type: "missing_payment_terms",
      severity: "notice",
      description: "Export lot has no agreed payment terms.",
      status: "open",
    });
  }

  // Human-raised claims — not derivable from field state.
  const claimLots = faker.helpers.arrayElements(
    lotRows!.filter((l) => ["received", "stored", "delivered"].includes(l.status)),
    2,
  );
  if (claimLots[0]) {
    exceptions.push({
      lot_id: claimLots[0].id,
      type: "weight_shortage",
      severity: "critical",
      description: "Weighbridge recorded 3.2 MT below the B/L quantity on intake.",
      status: "open",
    });
  }
  if (claimLots[1]) {
    exceptions.push({
      lot_id: claimLots[1].id,
      type: "compliance_block",
      severity: "critical",
      description: "Phytosanitary certificate pending; goods held pending clearance.",
      status: "open",
    });
  }

  const { error: excErr } = await db.from("exceptions").insert(exceptions);
  if (excErr) throw excErr;

  // summary
  const counts = await Promise.all(
    ["warehouses", "sheds", "commodities", "clients", "lots", "lot_movements", "invoices", "exceptions"].map(async (t) => {
      const { count } = await db.from(t).select("*", { count: "exact", head: true });
      return `${t}: ${count}`;
    })
  );
  console.log("Seed complete →", counts.join(", "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
