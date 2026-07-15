# Phase 3 — Warehouses & Sheds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Warehouse module on real data — warehouses list with occupancy, facility detail with per-shed breakdown, a clickable per-shed lot history (the demo gap fix), and Owner-only CRUD with audit entries.

**Architecture:** A new `lot_movements` stay table (interval model, `removed_at IS NULL` = still in shed) records shed history, kept in sync from `lots` by a `SECURITY DEFINER` trigger so `lots.shed_id` stays the single authoritative "current location". A `warehouse_occupancy` view rolls up the existing `shed_occupancy` view, measuring fullness against shed capacity. Server Components read through a small server-only data layer; Owner-only mutations are Server Actions validated with Zod, enforced by existing RLS, and audit-logged.

**Tech Stack:** Next.js 15 (App Router, Server Actions), React 19, Supabase (Postgres 17) + `@supabase/ssr`, Tailwind v4, shadcn/ui on Base UI, Zod, Vitest.

## Global Constraints

- Stack is pinned: **Next.js 15 / React 19 / Tailwind v4 / shadcn (Base UI)**. Do not upgrade.
- shadcn here uses **Base UI**, not Radix: triggers take a `render` prop (not `asChild`); `DropdownMenuLabel`/`DialogTitle`-style group labels must sit inside their Group where the component requires it; Base UI's `Button` expects a native `<button>` — for links use `buttonVariants` on a `<Link>`, never `Button render={<Link/>}`.
- **Schema is sacred** (PLAN.md §5.3): additive, newly-numbered migrations only. `0001`–`0009` are untouched.
- **RLS before UI** (PLAN.md §5.4): the database enforces the matrix. UI gating via `usePermissions()` is cosmetic, never the mechanism.
- Occupancy denominator is **shed capacity**, not warehouse rated capacity. Rated capacity is context; `unallocated = rated - shed_capacity`.
- Alert threshold reads `settings.low_stock_threshold_pct` (seeded `80`) from the DB — never hardcode 80.
- **Invariant:** `count(open stays) == count(lots where status='stored')`.
- Every Owner mutation writes an `audit_log` row (Phase 9 verify depends on it).
- Money/financials: none of these screens render financial columns. All three routes require `view_operations` only.
- Seeded users: `owner@tradeflow.example` / `management@tradeflow.example`, password `TradeFlow!2026`.
- Supabase CLI env pattern (used by every `db push`):
  ```bash
  export SUPABASE_ACCESS_TOKEN="$(node -e 'const fs=require("fs");const m=fs.readFileSync(".env.local","utf8").match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m);process.stdout.write(m[1].trim())')"
  DBPW="$(node -e 'const fs=require("fs");const m=fs.readFileSync(".env.local","utf8").match(/^SUPABASE_DB_PASSWORD=(.*)$/m);process.stdout.write(m[1].trim())')"
  echo "y" | npx supabase db push --password "$DBPW"
  ```
- Ad-hoc SQL verification: `npx tsx scripts/db.ts "<sql>"`.

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0010_lot_movements.sql` | `lot_movements` table, indexes, RLS, sync trigger, `warehouse_occupancy` view |
| `scripts/seed.ts` | Add synthesized stays (modify) |
| `src/lib/audit.ts` | `writeAudit()` — server-only audit helper |
| `src/lib/schemas/warehouse.ts` | Zod schemas shared client/server |
| `src/lib/warehouses.ts` | Server-only data layer (queries + threshold) |
| `src/components/occupancy-bar.tsx` | Occupancy meter (normal / warning / over) |
| `src/app/(app)/warehouses/page.tsx` | Warehouses list (modify) |
| `src/app/(app)/warehouses/[id]/page.tsx` | Facility detail (modify) |
| `src/app/(app)/warehouses/[id]/sheds/[shedId]/page.tsx` | Shed history — the gap fix |
| `src/app/(app)/warehouses/actions.ts` | Server Actions: warehouse/shed CRUD |
| `src/app/(app)/warehouses/warehouse-dialog.tsx` | Create/edit warehouse Dialog (client) |
| `src/app/(app)/warehouses/[id]/shed-dialog.tsx` | Create/edit shed Dialog (client) |
| `src/app/(app)/warehouses/[id]/delete-shed-button.tsx` | Delete with blocked-reason surfacing |

---

### Task 1: `lot_movements` + sync trigger + occupancy rollup

**Files:**
- Create: `supabase/migrations/0010_lot_movements.sql`

**Interfaces:**
- Produces: table `lot_movements(id, lot_id, shed_id, placed_at, removed_at, created_at)`; view `warehouse_occupancy(warehouse_id, name, rated_capacity_mt, shed_capacity_mt, stored_mt, occupancy_pct, shed_count)`; trigger `lots_sync_movement` on `lots`. Consumed by Tasks 2–7.

- [ ] **Step 1: Write `supabase/migrations/0010_lot_movements.sql`**

```sql
-- A "stay": one row per period a lot occupied a shed.
-- removed_at IS NULL  → the lot is still in that shed.
create table lot_movements (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references lots(id) on delete cascade,
  shed_id uuid not null references sheds(id),   -- no cascade → shed delete blocks
  placed_at timestamptz not null default now(),
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint stay_interval_valid check (removed_at is null or removed_at >= placed_at)
);

create index on lot_movements (shed_id);
create index on lot_movements (lot_id);

-- A lot can only be in one shed at a time.
create unique index one_open_stay_per_lot on lot_movements (lot_id) where removed_at is null;

alter table lot_movements enable row level security;
create policy lm_select on lot_movements for select to authenticated using (true);
create policy lm_write on lot_movements for all to authenticated
  using (current_app_role() in ('owner','management'))
  with check (current_app_role() in ('owner','management'));

-- Keeps history in sync with lots.shed_id / lots.status, which stay authoritative.
create or replace function public.sync_lot_movement()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Leaving storage, or moving shed → close the open stay.
  if tg_op = 'UPDATE' then
    if (new.status is distinct from 'stored')
       or (new.shed_id is distinct from old.shed_id) then
      update lot_movements
         set removed_at = now()
       where lot_id = new.id and removed_at is null;
    end if;
  end if;

  -- Stored in a shed with no open stay → open one.
  if new.status = 'stored' and new.shed_id is not null then
    if not exists (
      select 1 from lot_movements where lot_id = new.id and removed_at is null
    ) then
      insert into lot_movements (lot_id, shed_id) values (new.id, new.shed_id);
    end if;
  end if;

  return new;
end;
$$;

create trigger lots_sync_movement
  after insert or update of status, shed_id on lots
  for each row execute function public.sync_lot_movement();

-- Warehouse rollup. Occupancy is measured against SHED capacity (goods only
-- live in sheds); rated capacity is context, and rated - shed_capacity is
-- unallocated space.
create view public.warehouse_occupancy with (security_invoker = on) as
select
  w.id                            as warehouse_id,
  w.name,
  w.capacity_mt                   as rated_capacity_mt,
  coalesce(sum(s.capacity_mt), 0) as shed_capacity_mt,
  coalesce(sum(so.stored_mt), 0)  as stored_mt,
  case when coalesce(sum(s.capacity_mt), 0) > 0
    then round(coalesce(sum(so.stored_mt), 0) / sum(s.capacity_mt) * 100, 1)
    else 0 end                    as occupancy_pct,
  count(s.id)                     as shed_count
from public.warehouses w
left join public.sheds s on s.warehouse_id = w.id
left join public.shed_occupancy so on so.shed_id = s.id
group by w.id, w.name, w.capacity_mt;

grant select on public.warehouse_occupancy to authenticated, anon;
```

- [ ] **Step 2: Apply**

Run the `db push` block from Global Constraints.
Expected: `Applying migration 0010_lot_movements.sql...` then `Finished supabase db push.`

- [ ] **Step 3: Verify structure**

Run: `npx tsx scripts/db.ts "select count(*)::int as t from information_schema.tables where table_name='lot_movements'"`
Expected: `1`.

Run: `npx tsx scripts/db.ts "select warehouse_id, name, rated_capacity_mt, shed_capacity_mt, stored_mt, occupancy_pct, shed_count from warehouse_occupancy order by name"`
Expected: 2 rows. `shed_capacity_mt` = 7923 (Harbour) / 6121 (Inland); `occupancy_pct` > 0.

- [ ] **Step 4: Verify the trigger with a real round-trip** (do not wait for Phase 4)

```bash
npx tsx scripts/db.ts "
with l as (select id, shed_id from lots where status='stored' limit 1)
select (select count(*)::int from lot_movements m, l where m.lot_id = l.id and m.removed_at is null) as open_before"
```
Expected: `1` (the trigger opened a stay when the seed inserted the stored lot — if the seed ran before this migration existed, expect `0`; Task 2 backfills, so re-run this check after Task 2).

Then exercise a transition with **explicit statements**, checking after each.

> Do **not** use a `DO $$ … $$` block for this: `RAISE NOTICE` is not a result
> row so `scripts/db.ts` prints nothing, and a `raise exception` rolls the whole
> block back — leaving no evidence either way. Separate statements make each
> effect observable.

```bash
LOT=$(npx tsx scripts/db.ts "select id from lots where status='stored' limit 1" | grep -oE '[0-9a-f-]{36}')
SHED=$(npx tsx scripts/db.ts "select shed_id from lots where id='$LOT'" | grep -oE '[0-9a-f-]{36}')

# store → should OPEN a stay
npx tsx scripts/db.ts "update lots set status='dispatched' where id='$LOT'"
npx tsx scripts/db.ts "update lots set status='stored', shed_id='$SHED' where id='$LOT'"
npx tsx scripts/db.ts "select count(*) filter (where removed_at is null)::int as open from lot_movements where lot_id='$LOT'"
```
Expected: `open = 1`.

```bash
# dispatch → should CLOSE the stay
npx tsx scripts/db.ts "update lots set status='dispatched' where id='$LOT'"
npx tsx scripts/db.ts "select count(*) filter (where removed_at is null)::int as open,
                              count(*) filter (where removed_at is not null)::int as closed
                       from lot_movements where lot_id='$LOT'"
```
Expected: `open = 0`, `closed = 1`.

```bash
# restore state (Task 2 reseeds anyway, but leave the DB sane)
npx tsx scripts/db.ts "update lots set status='stored' where id='$LOT'"
npx tsx scripts/db.ts "delete from lot_movements where lot_id='$LOT'"
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0010_lot_movements.sql
git commit -m "feat(db): lot_movements stay history, sync trigger, warehouse occupancy view"
```

---

### Task 2: Seed synthesized stays

**Files:**
- Modify: `scripts/seed.ts`

**Interfaces:**
- Consumes: `lot_movements` (Task 1).
- Produces: seeded stays. Invariant after seeding: `count(open stays) == count(stored lots)` (17).

> **Note on ordering:** the wipe deletes `lots` before `sheds`; `lot_movements.lot_id` cascades from `lots`, so movements are gone before sheds are removed. No wipe change is needed.
>
> **Note on the trigger:** inserting stored lots fires `lots_sync_movement`, which auto-opens stays with `placed_at = now()`. The seed then backdates them. Closed stays for dispatched/delivered lots are inserted explicitly (they don't collide with the open-stay unique index).

- [ ] **Step 1: Add stay synthesis to `scripts/seed.ts`**

Insert this block immediately after the lots insert (`const { data: lotRows, error: lotErr } = await db.from("lots").insert(lots).select(); if (lotErr) throw lotErr;`) and before the invoices section:

```ts
  // 7b. Shed stays (lot_movements).
  //
  // The trigger already opened a stay for every stored lot at now(); backdate
  // those to the lot's arrival. Dispatched/delivered lots left storage before
  // this table existed, so their history is SYNTHESIZED — the shed they
  // actually occupied was never recorded. Each synthesized stay is confined to
  // a shed of the lot's own warehouse so a lot never appears in the history of
  // a warehouse it was never associated with.
  const shedsByWarehouse = new Map<string, typeof sheds>();
  for (const shed of sheds!) {
    const list = shedsByWarehouse.get(shed.warehouse_id) ?? [];
    list.push(shed);
    shedsByWarehouse.set(shed.warehouse_id, list as typeof sheds);
  }

  // Backdate the trigger-created open stays to each lot's arrival date.
  for (const lot of lotRows!.filter((l) => l.status === "stored" && l.arrival_date)) {
    const { error } = await db
      .from("lot_movements")
      .update({ placed_at: new Date(lot.arrival_date).toISOString() })
      .eq("lot_id", lot.id)
      .is("removed_at", null);
    if (error) throw new Error(`backdate stay ${lot.lot_number}: ${error.message}`);
  }

  // Closed stays for lots that have already left storage.
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
```

- [ ] **Step 2: Add `lot_movements` to the seed summary**

In the summary `Promise.all` list, change:
```ts
    ["warehouses", "sheds", "commodities", "clients", "lots", "invoices", "exceptions"].map(async (t) => {
```
to:
```ts
    ["warehouses", "sheds", "commodities", "clients", "lots", "lot_movements", "invoices", "exceptions"].map(async (t) => {
```

- [ ] **Step 3: Reseed**

Run: `npm run seed`
Expected: `Seed complete → warehouses: 2, sheds: 6, commodities: 10, clients: 80, lots: 100, lot_movements: 49, invoices: ~72, exceptions: 6`
(49 = 17 open + 32 closed.)

- [ ] **Step 4: Verify the invariant and the history**

```bash
npx tsx scripts/db.ts "
select
  (select count(*)::int from lot_movements where removed_at is null) as open_stays,
  (select count(*)::int from lots where status='stored')             as stored_lots,
  (select count(*)::int from lot_movements where removed_at is not null) as closed_stays"
```
Expected: `open_stays = stored_lots = 17`, `closed_stays = 32`.

Confirm no synthesized stay crosses warehouses:
```bash
npx tsx scripts/db.ts "
select count(*)::int as mismatched
from lot_movements m
join lots l on l.id = m.lot_id
join sheds s on s.id = m.shed_id
where s.warehouse_id is distinct from l.warehouse_id"
```
Expected: `0`.

Confirm every shed has some history to show:
```bash
npx tsx scripts/db.ts "
select s.name, count(m.id)::int as stays
from sheds s left join lot_movements m on m.shed_id = s.id
group by s.id, s.name order by s.name"
```
Expected: 6 rows, each `stays > 0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed.ts
git commit -m "feat(db): seed synthesized shed stays for lot history"
```

---

### Task 3: Data layer, Zod schemas, audit helper

**Files:**
- Create: `src/lib/warehouses.ts`, `src/lib/schemas/warehouse.ts`, `src/lib/audit.ts`
- Create: `src/lib/schemas/warehouse.test.ts`
- Modify: `package.json` (add `zod`)

**Interfaces:**
- Consumes: `createClient()` from `@/lib/supabase/server`; `getSession()` from `@/lib/auth`.
- Produces (used by Tasks 4–7):
  - `type WarehouseOccupancy = { warehouse_id, name, rated_capacity_mt, shed_capacity_mt, stored_mt, occupancy_pct, shed_count, unallocated_mt }` (all numbers except ids/name)
  - `type ShedOccupancy = { shed_id, warehouse_id, name, capacity_mt, stored_mt, occupancy_pct }`
  - `type Stay = { id, lot_id, lot_number, commodity, client, quantity_mt, status, placed_at, removed_at }`
  - `listWarehouses(): Promise<WarehouseOccupancy[]>`
  - `getWarehouse(id): Promise<{ id, name, address, capacity_mt } | null>`
  - `listSheds(warehouseId): Promise<ShedOccupancy[]>`
  - `getShed(shedId): Promise<{ id, name, warehouse_id, capacity_mt } | null>`
  - `getShedHistory(shedId): Promise<Stay[]>`
  - `getOccupancyThreshold(): Promise<number>`
  - `warehouseSchema`, `shedSchema` (Zod)
  - `writeAudit(action, entityType, entityId, details): Promise<void>`

- [ ] **Step 1: Install Zod**

Run: `npm i zod`
Expected: installs without error.

- [ ] **Step 2: Write the failing schema test — `src/lib/schemas/warehouse.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { warehouseSchema, shedSchema } from "./warehouse";

describe("warehouseSchema", () => {
  it("accepts a valid warehouse", () => {
    const r = warehouseSchema.safeParse({ name: "Harbour Terminal", address: "Dock Road", capacity_mt: "12000" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.capacity_mt).toBe(12000);
  });

  it("rejects a short name", () => {
    const r = warehouseSchema.safeParse({ name: "H", address: "", capacity_mt: "100" });
    expect(r.success).toBe(false);
  });

  it("rejects zero or negative capacity", () => {
    expect(warehouseSchema.safeParse({ name: "Depot", address: "", capacity_mt: "0" }).success).toBe(false);
    expect(warehouseSchema.safeParse({ name: "Depot", address: "", capacity_mt: "-5" }).success).toBe(false);
  });

  it("allows an empty address", () => {
    expect(warehouseSchema.safeParse({ name: "Depot", address: "", capacity_mt: "10" }).success).toBe(true);
  });
});

describe("shedSchema", () => {
  it("accepts a valid shed", () => {
    const r = shedSchema.safeParse({ name: "Shed A", capacity_mt: "2500" });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.capacity_mt).toBe(2500);
  });

  it("rejects an empty name", () => {
    expect(shedSchema.safeParse({ name: "", capacity_mt: "10" }).success).toBe(false);
  });

  it("rejects non-numeric capacity", () => {
    expect(shedSchema.safeParse({ name: "Shed A", capacity_mt: "abc" }).success).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./warehouse`.

- [ ] **Step 4: Create `src/lib/schemas/warehouse.ts`**

```ts
import { z } from "zod";

/** Shared by the Dialog forms and the Server Actions — one source of truth. */
export const warehouseSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(120),
  address: z.string().trim().max(240).optional().default(""),
  capacity_mt: z.coerce
    .number({ message: "Rated capacity must be a number" })
    .positive("Rated capacity must be greater than 0")
    .max(1_000_000, "Rated capacity looks too large"),
});

export const shedSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(80),
  capacity_mt: z.coerce
    .number({ message: "Capacity must be a number" })
    .positive("Capacity must be greater than 0")
    .max(1_000_000, "Capacity looks too large"),
});

export type WarehouseInput = z.infer<typeof warehouseSchema>;
export type ShedInput = z.infer<typeof shedSchema>;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test`
Expected: PASS — 14 tests (7 permissions + 7 schema).

- [ ] **Step 6: Create `src/lib/audit.ts`**

```ts
import "server-only";

import { createClient } from "@/lib/supabase/server";
import { getSession } from "@/lib/auth";

/**
 * Appends an audit entry. The DB trigger hash-chains it; audit_log is
 * insert-only (UPDATE/DELETE are revoked for authenticated).
 */
export async function writeAudit(
  action: string,
  entityType: string,
  entityId: string,
  details: Record<string, unknown>,
): Promise<void> {
  const supabase = await createClient();
  const session = await getSession();

  const { error } = await supabase.from("audit_log").insert({
    user_id: session?.user.id ?? null,
    action,
    entity_type: entityType,
    entity_id: entityId,
    details,
  });

  // An audit failure must not silently pass — it would break the Phase 9 chain.
  if (error) throw new Error(`audit write failed: ${error.message}`);
}
```

- [ ] **Step 7: Create `src/lib/warehouses.ts`**

```ts
import "server-only";

import { createClient } from "@/lib/supabase/server";

// PostgREST returns numeric columns as strings or numbers depending on the
// driver path; coerce once here so every consumer gets real numbers.
const num = (v: unknown): number => Number(v ?? 0);

export type WarehouseOccupancy = {
  warehouse_id: string;
  name: string;
  rated_capacity_mt: number;
  shed_capacity_mt: number;
  stored_mt: number;
  occupancy_pct: number;
  shed_count: number;
  unallocated_mt: number;
};

export type ShedOccupancy = {
  shed_id: string;
  warehouse_id: string;
  name: string;
  capacity_mt: number;
  stored_mt: number;
  occupancy_pct: number;
};

export type Stay = {
  id: string;
  lot_id: string;
  lot_number: string;
  commodity: string;
  client: string;
  quantity_mt: number;
  status: string;
  placed_at: string;
  removed_at: string | null;
};

export async function listWarehouses(): Promise<WarehouseOccupancy[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.from("warehouse_occupancy").select("*").order("name");
  if (error) throw new Error(`listWarehouses: ${error.message}`);

  return (data ?? []).map((w) => ({
    warehouse_id: w.warehouse_id,
    name: w.name,
    rated_capacity_mt: num(w.rated_capacity_mt),
    shed_capacity_mt: num(w.shed_capacity_mt),
    stored_mt: num(w.stored_mt),
    occupancy_pct: num(w.occupancy_pct),
    shed_count: num(w.shed_count),
    unallocated_mt: Math.max(0, num(w.rated_capacity_mt) - num(w.shed_capacity_mt)),
  }));
}

export async function getWarehouse(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("warehouses")
    .select("id, name, address, capacity_mt")
    .eq("id", id)
    .maybeSingle();
  return data ? { ...data, capacity_mt: num(data.capacity_mt) } : null;
}

export async function listSheds(warehouseId: string): Promise<ShedOccupancy[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shed_occupancy")
    .select("*")
    .eq("warehouse_id", warehouseId)
    .order("name");
  if (error) throw new Error(`listSheds: ${error.message}`);

  return (data ?? []).map((s) => ({
    shed_id: s.shed_id,
    warehouse_id: s.warehouse_id,
    name: s.name,
    capacity_mt: num(s.capacity_mt),
    stored_mt: num(s.stored_mt),
    occupancy_pct: num(s.occupancy_pct),
  }));
}

export async function getShed(shedId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("sheds")
    .select("id, name, warehouse_id, capacity_mt")
    .eq("id", shedId)
    .maybeSingle();
  return data ? { ...data, capacity_mt: num(data.capacity_mt) } : null;
}

/** Every lot that ever occupied this shed, newest placement first. */
export async function getShedHistory(shedId: string): Promise<Stay[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lot_movements")
    .select(
      "id, lot_id, placed_at, removed_at, lots!inner(lot_number, quantity_mt, status, commodities!inner(name), clients!inner(name))",
    )
    .eq("shed_id", shedId)
    .order("placed_at", { ascending: false });
  if (error) throw new Error(`getShedHistory: ${error.message}`);

  type Row = {
    id: string;
    lot_id: string;
    placed_at: string;
    removed_at: string | null;
    lots: {
      lot_number: string;
      quantity_mt: unknown;
      status: string;
      commodities: { name: string };
      clients: { name: string };
    };
  };

  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    lot_id: r.lot_id,
    lot_number: r.lots.lot_number,
    commodity: r.lots.commodities.name,
    client: r.lots.clients.name,
    quantity_mt: num(r.lots.quantity_mt),
    status: r.lots.status,
    placed_at: r.placed_at,
    removed_at: r.removed_at,
  }));
}

/**
 * Alert threshold from settings — CLAUDE.md requires this preference to
 * genuinely drive alert logic, so it is never hardcoded.
 */
export async function getOccupancyThreshold(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("settings")
    .select("value")
    .eq("key", "low_stock_threshold_pct")
    .maybeSingle();
  const parsed = Number(data?.value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 80;
}
```

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/lib/warehouses.ts src/lib/schemas src/lib/audit.ts package.json package-lock.json
git commit -m "feat(warehouses): data layer, zod schemas, audit helper"
```

---

### Task 4: Occupancy meter + warehouses list

**Files:**
- Create: `src/components/occupancy-bar.tsx`
- Modify: `src/app/(app)/warehouses/page.tsx`

**Interfaces:**
- Consumes: `listWarehouses()`, `getOccupancyThreshold()` (Task 3).
- Produces: `<OccupancyBar pct={number} threshold={number} />`; `occupancyState(pct, threshold): "normal" | "warning" | "over"` exported for reuse in Tasks 5–6.

> **Invoke the `dataviz` skill before writing the meter** (it is a meter/stat-tile) and the **`frontend-design` skill** before the page. Colour semantics must be consistent across normal / warning / over and legible in light and dark.

- [ ] **Step 1: Add the shadcn primitives**

Run: `npx shadcn@latest add card badge --yes`
Expected: creates `src/components/ui/card.tsx` and `src/components/ui/badge.tsx`.

- [ ] **Step 2: Create `src/components/occupancy-bar.tsx`**

```tsx
import { cn } from "@/lib/utils";

export type OccupancyState = "normal" | "warning" | "over";

/** Threshold comes from settings.low_stock_threshold_pct — never hardcoded. */
export function occupancyState(pct: number, threshold: number): OccupancyState {
  if (pct > 100) return "over";
  if (pct >= threshold) return "warning";
  return "normal";
}

const FILL: Record<OccupancyState, string> = {
  normal: "bg-foreground/70",
  warning: "bg-amber-500",
  over: "bg-destructive",
};

export function OccupancyBar({
  pct,
  threshold,
  className,
}: {
  pct: number;
  threshold: number;
  className?: string;
}) {
  const state = occupancyState(pct, threshold);
  const width = Math.min(100, Math.max(0, pct));

  return (
    <div
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      role="meter"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`Occupancy ${pct.toFixed(1)} percent`}
    >
      <div className={cn("h-full rounded-full transition-all", FILL[state])} style={{ width: `${width}%` }} />
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `src/app/(app)/warehouses/page.tsx`**

```tsx
import Link from "next/link";
import { ArrowRight, TriangleAlert } from "lucide-react";

import { OccupancyBar, occupancyState } from "@/components/occupancy-bar";
import { listWarehouses, getOccupancyThreshold } from "@/lib/warehouses";
import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";

const mt = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 0 })} MT`;

export default async function WarehousesPage() {
  const gate = await requireCapability("view_operations");
  if (!gate.allowed) return <BlockedScreen required="view_operations" role={gate.role} />;

  const [warehouses, threshold] = await Promise.all([listWarehouses(), getOccupancyThreshold()]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Warehouses &amp; Sheds</h1>
        <p className="text-sm text-muted-foreground">
          Storage capacity and occupancy across facilities. Alerts at {threshold}% of shed capacity.
        </p>
      </div>

      {warehouses.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm font-medium">No warehouses yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Add a facility to start tracking storage.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {warehouses.map((w) => {
            const state = occupancyState(w.occupancy_pct, threshold);
            return (
              <Link
                key={w.warehouse_id}
                href={`/warehouses/${w.warehouse_id}`}
                className="group flex flex-col gap-4 rounded-xl border bg-background p-5 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="font-medium">{w.name}</span>
                    <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                      {w.shed_count} sheds
                    </span>
                  </div>
                  {state !== "normal" ? (
                    <span className="flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-600 dark:text-amber-500">
                      <TriangleAlert className="size-3" />
                      {state === "over" ? "Over capacity" : "Near capacity"}
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between">
                    <span className="text-2xl font-semibold tabular-nums">{w.occupancy_pct.toFixed(1)}%</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {mt(w.stored_mt)} / {mt(w.shed_capacity_mt)}
                    </span>
                  </div>
                  <OccupancyBar pct={w.occupancy_pct} threshold={threshold} />
                </div>

                <div className="flex items-center justify-between border-t pt-3 text-xs text-muted-foreground">
                  <span>
                    Rated {mt(w.rated_capacity_mt)} · {mt(w.unallocated_mt)} unallocated
                  </span>
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify in the browser**

Run `npm run dev`, sign in as `owner@tradeflow.example`, open `/warehouses`.
Expected: two cards. Harbour ≈ `stored/7,923 MT`, Inland ≈ `stored/6,121 MT`; rated 12,000 / 8,000 with unallocated 4,077 / 1,879. Bars render; no console errors.

Cross-check the displayed numbers against SQL:
```bash
npx tsx scripts/db.ts "select name, stored_mt, shed_capacity_mt, occupancy_pct from warehouse_occupancy order by name"
```
Expected: matches the cards exactly.

- [ ] **Step 5: Commit**

```bash
git add src/components/occupancy-bar.tsx "src/app/(app)/warehouses/page.tsx" src/components/ui
git commit -m "feat(warehouses): occupancy meter and warehouses list"
```

---

### Task 5: Facility detail with per-shed breakdown

**Files:**
- Modify: `src/app/(app)/warehouses/[id]/page.tsx`

**Interfaces:**
- Consumes: `getWarehouse()`, `listSheds()`, `getOccupancyThreshold()` (Task 3); `OccupancyBar`, `occupancyState` (Task 4).

> **Invoke the `frontend-design` skill** before writing the JSX.

- [ ] **Step 1: Rewrite `src/app/(app)/warehouses/[id]/page.tsx`**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, ChevronLeft, TriangleAlert } from "lucide-react";

import { OccupancyBar, occupancyState } from "@/components/occupancy-bar";
import { getWarehouse, listSheds, getOccupancyThreshold } from "@/lib/warehouses";
import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";

const mt = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 0 })} MT`;

export default async function FacilityDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("view_operations");
  if (!gate.allowed) return <BlockedScreen required="view_operations" role={gate.role} />;

  const { id } = await params;
  const warehouse = await getWarehouse(id);
  if (!warehouse) notFound();

  const [sheds, threshold] = await Promise.all([listSheds(id), getOccupancyThreshold()]);

  const shedCapacity = sheds.reduce((sum, s) => sum + s.capacity_mt, 0);
  const stored = sheds.reduce((sum, s) => sum + s.stored_mt, 0);
  const unallocated = Math.max(0, warehouse.capacity_mt - shedCapacity);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Link
        href="/warehouses"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Warehouses
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{warehouse.name}</h1>
        <p className="text-sm text-muted-foreground">{warehouse.address ?? "No address on file"}</p>
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-xl border p-5 sm:grid-cols-4">
        {[
          { label: "Stored", value: mt(stored) },
          { label: "Shed capacity", value: mt(shedCapacity) },
          { label: "Rated capacity", value: mt(warehouse.capacity_mt) },
          { label: "Unallocated", value: mt(unallocated) },
        ].map((stat) => (
          <div key={stat.label} className="flex flex-col gap-1">
            <dt className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
              {stat.label}
            </dt>
            <dd className="text-lg font-semibold tabular-nums">{stat.value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Sheds</h2>

        {sheds.length === 0 ? (
          <div className="rounded-lg border border-dashed p-8 text-center">
            <p className="text-sm font-medium">No sheds in this facility</p>
            <p className="mt-1 text-sm text-muted-foreground">Add a shed to allocate storage capacity.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {sheds.map((s) => {
              const state = occupancyState(s.occupancy_pct, threshold);
              return (
                <li key={s.shed_id}>
                  <Link
                    href={`/warehouses/${id}/sheds/${s.shed_id}`}
                    className="group flex items-center gap-4 rounded-lg border bg-background p-4 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{s.name}</span>
                        {state !== "normal" ? (
                          <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500">
                            <TriangleAlert className="size-3" />
                            {state === "over" ? "Over capacity" : "Near capacity"}
                          </span>
                        ) : null}
                      </div>
                      <OccupancyBar pct={s.occupancy_pct} threshold={threshold} />
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      <span className="font-semibold tabular-nums">{s.occupancy_pct.toFixed(1)}%</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {mt(s.stored_mt)} / {mt(s.capacity_mt)}
                      </span>
                    </div>

                    <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify**

Open `/warehouses`, click Harbour Terminal Warehouse.
Expected: 4 stat tiles; 3 shed rows with bars; each row links to its shed. A bad id (`/warehouses/00000000-0000-0000-0000-000000000000`) renders the 404 page, not a crash.

Cross-check the sum against SQL (**"capacities sum correctly"**):
```bash
npx tsx scripts/db.ts "
select w.name,
       sum(so.capacity_mt) as shed_capacity,
       sum(so.stored_mt)   as stored
from warehouses w join shed_occupancy so on so.warehouse_id = w.id
group by w.name order by w.name"
```
Expected: matches the "Shed capacity" and "Stored" tiles.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/warehouses/[id]/page.tsx"
git commit -m "feat(warehouses): facility detail with per-shed breakdown"
```

---

### Task 6: Shed history route (the demo gap fix)

**Files:**
- Create: `src/app/(app)/warehouses/[id]/sheds/[shedId]/page.tsx`

**Interfaces:**
- Consumes: `getShed()`, `getShedHistory()`, `getWarehouse()` (Task 3).

> **Invoke the `frontend-design` skill** before writing the JSX. This screen is the demo gap fix — in the demo it was dead text.

- [ ] **Step 1: Create the page**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { getShed, getShedHistory, getWarehouse } from "@/lib/warehouses";
import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

const days = (from: string, to: string | null) =>
  Math.max(1, Math.round((new Date(to ?? Date.now()).getTime() - new Date(from).getTime()) / 86_400_000));

export default async function ShedHistoryPage({
  params,
}: {
  params: Promise<{ id: string; shedId: string }>;
}) {
  const gate = await requireCapability("view_operations");
  if (!gate.allowed) return <BlockedScreen required="view_operations" role={gate.role} />;

  const { id, shedId } = await params;
  const [shed, warehouse] = await Promise.all([getShed(shedId), getWarehouse(id)]);

  // 404 rather than render mismatched data if the shed isn't in this warehouse.
  if (!shed || !warehouse || shed.warehouse_id !== id) notFound();

  const history = await getShedHistory(shedId);
  const current = history.filter((s) => s.removed_at === null);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Link
        href={`/warehouses/${id}`}
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        {warehouse.name}
      </Link>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{shed.name}</h1>
        <p className="text-sm text-muted-foreground">
          {history.length} lot{history.length === 1 ? "" : "s"} have occupied this shed · {current.length} stored now
        </p>
      </div>

      {history.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm font-medium">No lots have been stored here</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Lot history appears once a lot is placed in this shed.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-left font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Lot</th>
                <th className="px-4 py-2.5 font-medium">Commodity</th>
                <th className="px-4 py-2.5 font-medium">Counterparty</th>
                <th className="px-4 py-2.5 text-right font-medium">Quantity</th>
                <th className="px-4 py-2.5 font-medium">Placed</th>
                <th className="px-4 py-2.5 font-medium">Removed</th>
                <th className="px-4 py-2.5 text-right font-medium">Days</th>
              </tr>
            </thead>
            <tbody>
              {history.map((s) => (
                <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2.5">
                    <Link href={`/lots/${s.lot_id}`} className="font-mono text-xs underline-offset-4 hover:underline">
                      {s.lot_number}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">{s.commodity}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{s.client}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {s.quantity_mt.toLocaleString("en-US")} MT
                  </td>
                  <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{fmtDate(s.placed_at)}</td>
                  <td className="px-4 py-2.5">
                    {s.removed_at ? (
                      <span className="tabular-nums text-muted-foreground">{fmtDate(s.removed_at)}</span>
                    ) : (
                      <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-medium">
                        Currently stored
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    {days(s.placed_at, s.removed_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify the history filters correctly**

Open a shed from the facility detail page.
Expected: a populated table; some rows say "Currently stored", others show a removal date.

Cross-check counts against SQL for that shed id:
```bash
npx tsx scripts/db.ts "
select s.name,
       count(*)::int                                          as total_stays,
       count(*) filter (where m.removed_at is null)::int      as currently_stored
from lot_movements m join sheds s on s.id = m.shed_id
group by s.name order by s.name"
```
Expected: the page's "N lots have occupied this shed · M stored now" matches its row.

Confirm the mismatched-shed guard: take a shed id from warehouse A and put it under warehouse B's URL — expect the 404 page.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/warehouses/[id]/sheds"
git commit -m "feat(warehouses): per-shed lot history route (demo gap fix)"
```

---

### Task 7: Owner-only CRUD with audit and delete guard

**Files:**
- Create: `src/app/(app)/warehouses/actions.ts`, `src/app/(app)/warehouses/warehouse-dialog.tsx`, `src/app/(app)/warehouses/[id]/shed-dialog.tsx`, `src/app/(app)/warehouses/[id]/delete-shed-button.tsx`
- Modify: `src/app/(app)/warehouses/page.tsx`, `src/app/(app)/warehouses/[id]/page.tsx`

**Interfaces:**
- Consumes: `warehouseSchema`, `shedSchema` (Task 3); `writeAudit()` (Task 3); `requireCapability()`.
- Produces: `type ActionState = { error: string | null; fieldErrors?: Record<string, string>; ok?: boolean }`; `saveWarehouse(prev, formData)`, `saveShed(prev, formData)`, `deleteShed(prev, formData)` — all `(ActionState, FormData) => Promise<ActionState>`. Actions set `ok: true` **only** on a successful write; the Dialogs close on `ok` and stay open (values intact) on any error.

> **Invoke the `frontend-design` skill** before the Dialog JSX. Use the shadcn **Dialog** — this is the direct fix for the demo's un-closable modal.

- [ ] **Step 1: Add the Dialog primitive**

Run: `npx shadcn@latest add dialog --yes`
Expected: creates `src/components/ui/dialog.tsx`.

- [ ] **Step 2: Create `src/app/(app)/warehouses/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { warehouseSchema, shedSchema } from "@/lib/schemas/warehouse";

export type ActionState = {
  error: string | null;
  fieldErrors?: Record<string, string>;
  /** Set only on a successful write; the Dialogs close on this. */
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

export async function saveWarehouse(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const gate = await requireCapability("manage_users");
  if (!gate.allowed) return { error: "Owner access required." };

  const parsed = warehouseSchema.safeParse({
    name: formData.get("name"),
    address: formData.get("address"),
    capacity_mt: formData.get("capacity_mt"),
  });
  if (!parsed.success) return { error: null, fieldErrors: zodFieldErrors(parsed.error.issues) };

  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();

  if (id) {
    const { data: before } = await supabase
      .from("warehouses")
      .select("name, address, capacity_mt")
      .eq("id", id)
      .maybeSingle();

    const { error } = await supabase.from("warehouses").update(parsed.data).eq("id", id);
    if (error) return { error: error.message };

    await writeAudit("update", "warehouse", id, { before, after: parsed.data });
  } else {
    const { data, error } = await supabase.from("warehouses").insert(parsed.data).select("id").single();
    if (error) return { error: error.message };

    await writeAudit("create", "warehouse", data.id, { after: parsed.data });
  }

  revalidatePath("/warehouses");
  return { error: null, ok: true };
}

export async function saveShed(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const gate = await requireCapability("manage_users");
  if (!gate.allowed) return { error: "Owner access required." };

  const parsed = shedSchema.safeParse({
    name: formData.get("name"),
    capacity_mt: formData.get("capacity_mt"),
  });
  if (!parsed.success) return { error: null, fieldErrors: zodFieldErrors(parsed.error.issues) };

  const id = String(formData.get("id") ?? "");
  const warehouseId = String(formData.get("warehouse_id") ?? "");
  if (!warehouseId) return { error: "Missing warehouse." };

  const supabase = await createClient();

  if (id) {
    const { data: before } = await supabase
      .from("sheds")
      .select("name, capacity_mt")
      .eq("id", id)
      .maybeSingle();

    const { error } = await supabase.from("sheds").update(parsed.data).eq("id", id);
    if (error) return { error: error.message };

    await writeAudit("update", "shed", id, { before, after: parsed.data });
  } else {
    const { data, error } = await supabase
      .from("sheds")
      .insert({ ...parsed.data, warehouse_id: warehouseId })
      .select("id")
      .single();
    if (error) return { error: error.message };

    await writeAudit("create", "shed", data.id, { after: { ...parsed.data, warehouse_id: warehouseId } });
  }

  revalidatePath(`/warehouses/${warehouseId}`);
  revalidatePath("/warehouses");
  return { error: null, ok: true };
}

/**
 * Refuses to delete a shed that holds lots or has history, with a reason.
 * Trade records are never silently destroyed.
 */
export async function deleteShed(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const gate = await requireCapability("manage_users");
  if (!gate.allowed) return { error: "Owner access required." };

  const id = String(formData.get("id") ?? "");
  const warehouseId = String(formData.get("warehouse_id") ?? "");
  if (!id) return { error: "Missing shed." };

  const supabase = await createClient();

  const { data: shed } = await supabase.from("sheds").select("name").eq("id", id).maybeSingle();

  const { count: storedCount } = await supabase
    .from("lots")
    .select("*", { count: "exact", head: true })
    .eq("shed_id", id)
    .eq("status", "stored");

  const { count: historyCount } = await supabase
    .from("lot_movements")
    .select("*", { count: "exact", head: true })
    .eq("shed_id", id);

  if ((storedCount ?? 0) > 0 || (historyCount ?? 0) > 0) {
    const parts: string[] = [];
    if ((storedCount ?? 0) > 0) parts.push(`${storedCount} stored lot${storedCount === 1 ? "" : "s"}`);
    if ((historyCount ?? 0) > 0) parts.push(`${historyCount} historical record${historyCount === 1 ? "" : "s"}`);
    return {
      error: `${shed?.name ?? "This shed"} holds ${parts.join(" and ")}. Move them before deleting.`,
    };
  }

  const { error } = await supabase.from("sheds").delete().eq("id", id);
  if (error) return { error: error.message };

  await writeAudit("delete", "shed", id, { before: { name: shed?.name } });

  revalidatePath(`/warehouses/${warehouseId}`);
  revalidatePath("/warehouses");
  return { error: null, ok: true };
}
```

- [ ] **Step 3: Create `src/app/(app)/warehouses/warehouse-dialog.tsx`**

```tsx
"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { saveWarehouse, type ActionState } from "./actions";

const labelClass = "font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground";

type Warehouse = { id: string; name: string; address: string | null; capacity_mt: number };

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : isEdit ? "Save changes" : "Create warehouse"}
    </Button>
  );
}

export function WarehouseDialog({ warehouse }: { warehouse?: Warehouse }) {
  const isEdit = Boolean(warehouse);
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ActionState, FormData>(saveWarehouse, { error: null });

  // Close only on a successful save. `state` gets a new identity on every
  // action result, so this fires per submission — never on a plain reopen —
  // and an error leaves the Dialog open with the user's values intact.
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant={isEdit ? "outline" : "default"} size="sm" className="gap-1.5">
            {isEdit ? "Edit" : (<><Plus className="size-4" />New warehouse</>)}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogTitle>{isEdit ? "Edit warehouse" : "New warehouse"}</DialogTitle>
        <DialogDescription>
          Rated capacity is the facility total. Sheds allocate part of it.
        </DialogDescription>

        <form action={formAction} className="mt-2 flex flex-col gap-4">
          {warehouse ? <input type="hidden" name="id" value={warehouse.id} /> : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name" className={labelClass}>Name</Label>
            <Input id="name" name="name" defaultValue={warehouse?.name} required />
            {state.fieldErrors?.name ? (
              <p className="text-xs text-destructive">{state.fieldErrors.name}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="address" className={labelClass}>Address</Label>
            <Input id="address" name="address" defaultValue={warehouse?.address ?? ""} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="capacity_mt" className={labelClass}>Rated capacity (MT)</Label>
            <Input
              id="capacity_mt"
              name="capacity_mt"
              type="number"
              step="1"
              min="1"
              defaultValue={warehouse?.capacity_mt}
              required
            />
            {state.fieldErrors?.capacity_mt ? (
              <p className="text-xs text-destructive">{state.fieldErrors.capacity_mt}</p>
            ) : null}
          </div>

          {state.error ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {state.error}
            </p>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton isEdit={isEdit} />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Create `src/app/(app)/warehouses/[id]/shed-dialog.tsx`**

```tsx
"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { saveShed, type ActionState } from "../actions";

const labelClass = "font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground";

type Shed = { id: string; name: string; capacity_mt: number };

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : isEdit ? "Save changes" : "Add shed"}
    </Button>
  );
}

export function ShedDialog({ warehouseId, shed }: { warehouseId: string; shed?: Shed }) {
  const isEdit = Boolean(shed);
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ActionState, FormData>(saveShed, { error: null });

  // Close only on a successful save; errors keep the Dialog open with values.
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant={isEdit ? "ghost" : "default"} size="sm" className="gap-1.5">
            {isEdit ? "Edit" : (<><Plus className="size-4" />Add shed</>)}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogTitle>{isEdit ? `Edit ${shed?.name}` : "Add shed"}</DialogTitle>
        <DialogDescription>Capacity in metric tonnes available for storage.</DialogDescription>

        <form action={formAction} className="mt-2 flex flex-col gap-4">
          <input type="hidden" name="warehouse_id" value={warehouseId} />
          {shed ? <input type="hidden" name="id" value={shed.id} /> : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="shed-name" className={labelClass}>Name</Label>
            <Input id="shed-name" name="name" defaultValue={shed?.name} required />
            {state.fieldErrors?.name ? (
              <p className="text-xs text-destructive">{state.fieldErrors.name}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="shed-capacity" className={labelClass}>Capacity (MT)</Label>
            <Input
              id="shed-capacity"
              name="capacity_mt"
              type="number"
              step="1"
              min="1"
              defaultValue={shed?.capacity_mt}
              required
            />
            {state.fieldErrors?.capacity_mt ? (
              <p className="text-xs text-destructive">{state.fieldErrors.capacity_mt}</p>
            ) : null}
          </div>

          {state.error ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {state.error}
            </p>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton isEdit={isEdit} />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 5: Create `src/app/(app)/warehouses/[id]/delete-shed-button.tsx`**

```tsx
"use client";

import { useActionState } from "react";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { deleteShed, type ActionState } from "../actions";

/**
 * Deletion is refused (with a reason) when the shed holds lots or history —
 * the reason is surfaced inline rather than thrown away.
 */
export function DeleteShedButton({ shedId, warehouseId }: { shedId: string; warehouseId: string }) {
  const [state, formAction] = useActionState<ActionState, FormData>(deleteShed, { error: null });

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <input type="hidden" name="id" value={shedId} />
        <input type="hidden" name="warehouse_id" value={warehouseId} />
        <Button type="submit" variant="ghost" size="icon-sm" aria-label="Delete shed">
          <Trash2 className="size-4" />
        </Button>
      </form>
      {state.error ? (
        <p role="alert" className="max-w-xs text-right text-xs text-destructive">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 6: Wire the controls into the pages**

In `src/app/(app)/warehouses/page.tsx`:
```tsx
import { WarehouseDialog } from "./warehouse-dialog";
import { can } from "@/lib/permissions";
```
Replace the heading block with:
```tsx
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Warehouses &amp; Sheds</h1>
          <p className="text-sm text-muted-foreground">
            Storage capacity and occupancy across facilities. Alerts at {threshold}% of shed capacity.
          </p>
        </div>
        {can(gate.session.profile.role, "manage_users") ? <WarehouseDialog /> : null}
      </div>
```

In `src/app/(app)/warehouses/[id]/page.tsx`:
```tsx
import { ShedDialog } from "./shed-dialog";
import { DeleteShedButton } from "./delete-shed-button";
import { WarehouseDialog } from "../warehouse-dialog";
import { can } from "@/lib/permissions";
```
Add `const isOwner = can(gate.session.profile.role, "manage_users");` after the gate, put `{isOwner ? <WarehouseDialog warehouse={{ ...warehouse, address: warehouse.address }} /> : null}` beside the `<h1>`, change the Sheds heading row to:
```tsx
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">Sheds</h2>
          {isOwner ? <ShedDialog warehouseId={id} /> : null}
        </div>
```
and append inside each shed `<li>`, **outside** the `<Link>` (a form cannot be nested in a link):
```tsx
                  {isOwner ? (
                    <div className="flex items-center gap-1 pl-2">
                      <ShedDialog warehouseId={id} shed={{ id: s.shed_id, name: s.name, capacity_mt: s.capacity_mt }} />
                      <DeleteShedButton shedId={s.shed_id} warehouseId={id} />
                    </div>
                  ) : null}
```
wrapping the `<Link>` and the controls in `<div className="flex items-center gap-2">`.

- [ ] **Step 7: Verify CRUD, RBAC, audit, and the delete guard**

As **Owner**:
- "New warehouse" → Dialog opens; the **× closes it** (the demo's bug); Cancel closes it.
- Submit with name `X` → inline "Name must be at least 2 characters"; Dialog stays open.
- Create a warehouse "Test Depot" rated 500 → appears in the list with 0 sheds, 0.0%.
- Add shed "Shed Z" 200 MT → facility detail shows it at 0.0%.
- Delete "Shed Z" (no lots) → removed.
- Delete a seeded shed (has lots) → refused inline: *"Shed A holds N stored lots and M historical records. Move them before deleting."*

Confirm the audit entries and that the chain still verifies:
```bash
npx tsx scripts/db.ts "select seq, action, entity_type, created_at from audit_log order by seq desc limit 5"
npx tsx scripts/db.ts "select verify_audit_chain() as first_break"
```
Expected: create/update/delete rows for `warehouse`/`shed`; `first_break` NULL.

As **Management** (dev switcher):
- `/warehouses` renders, but **no** "New warehouse", Edit, or Delete controls appear.

Confirm the database refuses a Management write regardless of UI:
```bash
npx tsx -e '
import { config } from "dotenv"; config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
const c = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } });
await c.auth.signInWithPassword({ email: "management@tradeflow.example", password: "TradeFlow!2026" });
const { error } = await c.from("warehouses").insert({ name: "Hack Depot", capacity_mt: 1 });
console.log(error ? "PASS: RLS blocked Management insert" : "FAIL: Management inserted a warehouse");
process.exit(error ? 0 : 1);'
```
Expected: `PASS: RLS blocked Management insert`.

- [ ] **Step 8: Clean up the test rows**

```bash
npx tsx scripts/db.ts "delete from sheds where name='Shed Z'"
npx tsx scripts/db.ts "delete from warehouses where name='Test Depot'"
```

- [ ] **Step 9: Commit**

```bash
git add "src/app/(app)/warehouses" src/components/ui/dialog.tsx
git commit -m "feat(warehouses): owner-only CRUD with zod, audit entries, delete guard"
```

---

### Task 8: Full acceptance verification

**Files:** none (verification only)

- [ ] **Step 1: Static gates**

Run: `npm test` → all PASS (permissions + warehouse schemas).
Run: `npx tsc --noEmit` → exit 0.
Run: `npm run lint` → exit 0.
Run: `npm run build` → succeeds.

> If the dev server is running, `npm run build` will clobber its `.next` and the
> dev server will start 500-ing. Stop the dev server before building, then
> `rm -rf .next` and restart it.

- [ ] **Step 2: The phase's verify checklist (PLAN.md)**

```bash
# capacities sum correctly
npx tsx scripts/db.ts "
select w.name,
       wo.shed_capacity_mt,
       (select sum(capacity_mt) from sheds where warehouse_id = w.id) as sheds_sum,
       wo.stored_mt,
       (select coalesce(sum(quantity_mt),0) from lots where warehouse_id = w.id and status='stored') as lots_sum
from warehouses w join warehouse_occupancy wo on wo.warehouse_id = w.id
order by w.name"
```
Expected: `shed_capacity_mt == sheds_sum` and `stored_mt == lots_sum` for both rows.

```bash
# invariant still holds
npx tsx scripts/db.ts "
select (select count(*)::int from lot_movements where removed_at is null) as open_stays,
       (select count(*)::int from lots where status='stored')             as stored_lots"
```
Expected: equal.

- [ ] **Step 3: Browser pass**

As Owner: `/warehouses` → card → facility → shed history → lot link. Check mobile width (warehouse-floor screen): cards stack, shed history table scrolls horizontally inside its container without the page scrolling sideways.

As Management: same three screens render; no CRUD controls anywhere.

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "test(warehouses): Phase 3 acceptance verification"
```

---

## Phase 3 Done — Verify Checklist (PLAN.md)

- [ ] Warehouses list: capacity cards + occupancy bars, driven by `warehouse_occupancy`.
- [ ] Facility detail: per-shed breakdown with occupancy.
- [ ] **Clickable historical-lot list per shed** (demo gap fix) — real data, filters correctly.
- [ ] Warehouse/shed CRUD, Owner-only, enforced by RLS and audit-logged.
- [ ] Occupancy math derived from stored lots in SQL views.
- [ ] **Capacities sum correctly** (shed capacity == Σ sheds; stored == Σ stored lots).
- [ ] **History list filters correctly** (per-shed counts match SQL).
- [ ] Invariant `open stays == stored lots` holds.
- [ ] Alert threshold read from `settings`, not hardcoded.
- [ ] Delete of an occupied shed blocked with an explanation.
- [ ] `npm test`, `tsc`, `lint`, `build` clean.

## Self-review notes (author)

- **Spec coverage:** `lot_movements` + trigger + `warehouse_occupancy` → Task 1; synthesized stays → Task 2; data layer/Zod/audit → Task 3; list + meter → Task 4; facility detail → Task 5; shed history route → Task 6; CRUD + delete guard + audit → Task 7; verification → Task 8. Error-handling items from the spec (404 on bad id, 404 on shed/warehouse mismatch, inline Zod errors, delete reason, RLS refusal) each have a concrete step.
- **Type consistency:** `WarehouseOccupancy`/`ShedOccupancy`/`Stay` field names match between Task 3's data layer and Tasks 4–6's consumers; `ActionState` identical across Task 7's actions and all three client components; `occupancyState()` signature identical in Tasks 4–5.
- **Bug caught in review:** the Dialogs originally did `await formAction(fd); setOpen(false)`, which closed the Dialog unconditionally — including on a Zod failure, so the user would never see the inline error the spec requires. Fixed with an explicit `ok` flag on `ActionState` plus `useEffect(() => { if (state.ok) setOpen(false) }, [state])`. Keying the effect on the whole `state` object (not `state.ok`) matters: `state` gets a fresh identity per action result, so it fires once per submission and never on a plain reopen. Task 7 Step 7 verifies the failure path explicitly (submit name `X` → error shown, Dialog still open).
- **Base UI traps:** Dialog triggers use `render`; no `Button render={<Link/>}` anywhere (cards are plain `<Link>`s with their own styling).
- **Nesting trap called out:** the shed delete `<form>` must live outside the shed `<Link>` — nesting a form in an anchor is invalid HTML and breaks the click target. Task 7 Step 6 states this explicitly.
- **Trigger tested now, not in Phase 4:** Task 1 Step 4 exercises store → dispatch → store directly in SQL, since Phase 3's UI never changes a lot's status.
- **Known risk:** `saveWarehouse`/`saveShed` gate on `manage_users` because that is the capability the matrix gives Owner alone, and Phase 1's RLS on `warehouses`/`sheds` uses `is_owner()`. If a future Finance/Warehouse role should manage facilities, this needs a dedicated `manage_facilities` capability — out of scope for v1, noted so it isn't mistaken for an oversight.
