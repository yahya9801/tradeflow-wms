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
  const shedRows: Array<{ warehouse_id: string; name: string; capacity_mt: number }> = [];
  for (const wh of whRows!) {
    const n = faker.number.int({ min: 3, max: 4 });
    for (let i = 1; i <= n; i++) {
      shedRows.push({
        warehouse_id: wh.id,
        name: `Shed ${String.fromCharCode(64 + i)}`,
        capacity_mt: faker.number.int({ min: 1500, max: 3000 }),
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
  const lots = Array.from({ length: 100 }, (_, i) => {
    const direction = faker.helpers.arrayElement(["import", "export"] as const);
    const status = LOT_STATUSES[i % LOT_STATUSES.length];
    const commodity = faker.helpers.arrayElement(commodities!);
    const counterparty =
      direction === "import" ? faker.helpers.arrayElement(suppliers) : faker.helpers.arrayElement(buyers);
    const shed = status === "stored" ? faker.helpers.arrayElement(sheds!) : null;
    return {
      direction,
      commodity_id: commodity.id,
      client_id: counterparty.id,
      quantity_mt: faker.number.int({ min: 100, max: 1500 }),
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

  // 9. a few open exceptions on real lots
  const sampleLots = faker.helpers.arrayElements(lotRows!, 6);
  const excTypes = ["weight_shortage", "missing_bl", "missing_payment_terms", "compliance_block", "weight_shortage", "missing_bl"] as const;
  const excSev = ["critical", "warning", "notice", "critical", "warning", "notice"] as const;
  const exc = sampleLots.map((lot, i) => ({
    lot_id: lot.id,
    type: excTypes[i],
    severity: excSev[i],
    description: "Auto-flagged during intake; requires review.",
    status: "open",
  }));
  await db.from("exceptions").insert(exc);

  // summary
  const counts = await Promise.all(
    ["warehouses", "sheds", "commodities", "clients", "lots", "invoices", "exceptions"].map(async (t) => {
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
