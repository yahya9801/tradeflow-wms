# Phase 4 — Lots Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Lot lifecycle — filterable list, direction-aware create/edit form with real validation, and a Lot Detail with a working status stepper, permission-gated financials, and resolvable exceptions.

**Architecture:** A `BEFORE UPDATE` trigger on `lots` enforces the two physical rules (next-step-only transitions with an Owner step-back; no storing more than a shed can hold) so they can't be bypassed by a direct API call. A server-only data layer reads through `lots_view`, so `market_value` is masked by the database for non-financial roles. Server Actions validate with Zod, gate on `requireCapability`, and audit-log every mutation. The UI offers only legal transitions on top — cosmetic, never the mechanism.

**Tech Stack:** Next.js 15 (App Router, Server Actions), React 19, Supabase (Postgres 17) + `@supabase/ssr`, Tailwind v4, shadcn/ui on Base UI, Zod, Vitest.

## Global Constraints

- Stack pinned: **Next.js 15 / React 19 / Tailwind v4 / shadcn (Base UI)**. Do not upgrade.
- **Base UI, not Radix:** triggers take `render` (not `asChild`); `DropdownMenuLabel`/`DialogTitle` group labels must sit inside their Group; Base UI `Button` expects a native `<button>` — for links use `buttonVariants` on a `<Link>`, never `Button render={<Link/>}`.
- **Schema is sacred** (PLAN.md §5.3): additive, newly-numbered migrations only. `0001`–`0010` untouched.
- **RLS before UI** (PLAN.md §5.4). UI gating via `usePermissions()`/`can()` is cosmetic.
- **RLS does not error on UPDATE/DELETE** — it matches zero rows and reports success. Server Actions MUST gate on `requireCapability` or they report a misleading "saved". (Phase 3 lesson.)
- **React 19 auto-resets uncontrolled forms after an action** — form inputs MUST be controlled or the user's values vanish on a validation error. (Phase 3 lesson.)
- Reads go through **`lots_view`**, never `lots`, so `market_value` is DB-masked.
- **New lots are created at `pending`.** Status is never a form field.
- **bags** is derived (`quantity_mt * 1000 / bag_weight_kg`), shown live, never stored.
- Colors: use tokens. The reserved status palette (`#fab219` warning, `#d03b3b` critical) ships with an icon + label — never color alone.
- Seeded users: `owner@tradeflow.example` / `management@tradeflow.example`, password `TradeFlow!2026`.
- `db push` env pattern:
  ```bash
  export SUPABASE_ACCESS_TOKEN="$(node -e 'const fs=require("fs");const m=fs.readFileSync(".env.local","utf8").match(/^SUPABASE_ACCESS_TOKEN=(.*)$/m);process.stdout.write(m[1].trim())')"
  DBPW="$(node -e 'const fs=require("fs");const m=fs.readFileSync(".env.local","utf8").match(/^SUPABASE_DB_PASSWORD=(.*)$/m);process.stdout.write(m[1].trim())')"
  echo "y" | npx supabase db push --password "$DBPW"
  ```
- Ad-hoc SQL: `npx tsx scripts/db.ts "<sql>"`. Note it prints **rows only** — `RAISE NOTICE` is invisible and a `DO` block rolls back on exception, so verify with explicit statements.
- Stop the dev server before `npm run build` (they share `.next`).

## File structure

| File | Responsibility |
|---|---|
| `supabase/migrations/0011_lot_rules.sql` | Transition + capacity trigger |
| `scripts/seed.ts` | Make field-backed exceptions true (modify) |
| `src/lib/lot-status.ts` | Pure lifecycle logic + `allowedTransitions()` |
| `src/lib/lot-status.test.ts` | Vitest — mirrors the SQL trigger |
| `src/lib/schemas/lot.ts` | Zod schemas shared client/server |
| `src/lib/schemas/lot.test.ts` | Vitest — the conditional B/L + terms rules |
| `src/lib/lots.ts` | Server-only data layer (reads `lots_view`) |
| `src/app/(app)/lots/page.tsx` | List: search, filters, tabs, pagination |
| `src/app/(app)/lots/lot-filters.tsx` | URL-driven filter controls (client) |
| `src/app/(app)/lots/actions.ts` | Server Actions: save, transition, resolve |
| `src/app/(app)/lots/lot-form.tsx` | Shared create/edit form (client) |
| `src/app/(app)/lots/new/page.tsx` | Create route |
| `src/app/(app)/lots/[id]/edit/page.tsx` | Edit route |
| `src/app/(app)/lots/[id]/page.tsx` | Detail: stepper, cards, invoices, exceptions |
| `src/app/(app)/lots/[id]/status-stepper.tsx` | Stepper + transition actions (client) |
| `src/app/(app)/lots/[id]/exception-list.tsx` | Resolve actions (client) |
| `scripts/verify-lot-rules.ts` | Proves the DB rejects illegal moves + leaks no money |

---

### Task 1: Lifecycle logic (TDD, pure)

**Files:**
- Create: `src/lib/lot-status.ts`, `src/lib/lot-status.test.ts`

**Interfaces:**
- Produces: `type LotStatus = "pending"|"in_transit"|"received"|"stored"|"dispatched"|"delivered"`; `LOT_STATUSES: readonly LotStatus[]` (lifecycle order); `statusIndex(s): number`; `allowedTransitions(current: LotStatus, isOwner: boolean): LotStatus[]`; `STATUS_LABELS: Record<LotStatus, string>`. Consumed by Tasks 5, 7, 8.

> This module is the **UI mirror** of the SQL trigger in Task 2. The tests assert the same rules so the two can't drift.

- [ ] **Step 1: Write the failing test — `src/lib/lot-status.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { LOT_STATUSES, statusIndex, allowedTransitions } from "./lot-status";

describe("lifecycle order", () => {
  it("is the CLAUDE.md order", () => {
    expect(LOT_STATUSES).toEqual([
      "pending", "in_transit", "received", "stored", "dispatched", "delivered",
    ]);
  });

  it("indexes in order", () => {
    expect(statusIndex("pending")).toBe(0);
    expect(statusIndex("delivered")).toBe(5);
  });
});

describe("allowedTransitions — management", () => {
  it("offers only the next step", () => {
    expect(allowedTransitions("pending", false)).toEqual(["in_transit"]);
    expect(allowedTransitions("stored", false)).toEqual(["dispatched"]);
  });

  it("offers nothing at the end of the lifecycle", () => {
    expect(allowedTransitions("delivered", false)).toEqual([]);
  });

  it("never offers a backward step", () => {
    for (const s of LOT_STATUSES) {
      for (const t of allowedTransitions(s, false)) {
        expect(statusIndex(t)).toBeGreaterThan(statusIndex(s));
      }
    }
  });
});

describe("allowedTransitions — owner", () => {
  it("offers the next step plus one step back", () => {
    expect(allowedTransitions("stored", true)).toEqual(["dispatched", "received"]);
  });

  it("has no step back from the first status", () => {
    expect(allowedTransitions("pending", true)).toEqual(["in_transit"]);
  });

  it("offers only the step back at the end", () => {
    expect(allowedTransitions("delivered", true)).toEqual(["dispatched"]);
  });

  it("never offers more than two actions", () => {
    for (const s of LOT_STATUSES) {
      expect(allowedTransitions(s, true).length).toBeLessThanOrEqual(2);
    }
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./lot-status`.

- [ ] **Step 3: Implement `src/lib/lot-status.ts`**

```ts
/**
 * The lot lifecycle. This mirrors the SQL trigger in 0011_lot_rules.sql —
 * the database is the enforcement mechanism; this exists so the UI can offer
 * only the moves that will actually succeed. lot-status.test.ts pins both to
 * the same rules so they cannot drift.
 */
export type LotStatus =
  | "pending"
  | "in_transit"
  | "received"
  | "stored"
  | "dispatched"
  | "delivered";

export const LOT_STATUSES: readonly LotStatus[] = [
  "pending",
  "in_transit",
  "received",
  "stored",
  "dispatched",
  "delivered",
];

export const STATUS_LABELS: Record<LotStatus, string> = {
  pending: "Pending",
  in_transit: "In Transit",
  received: "Received",
  stored: "Stored",
  dispatched: "Dispatched",
  delivered: "Delivered",
};

export function statusIndex(status: LotStatus): number {
  return LOT_STATUSES.indexOf(status);
}

/**
 * Next step for anyone; Owner may also step back one to correct a mistake.
 * Forward first so the primary action is always [0].
 */
export function allowedTransitions(current: LotStatus, isOwner: boolean): LotStatus[] {
  const i = statusIndex(current);
  const out: LotStatus[] = [];
  if (i < LOT_STATUSES.length - 1) out.push(LOT_STATUSES[i + 1]);
  if (isOwner && i > 0) out.push(LOT_STATUSES[i - 1]);
  return out;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test`
Expected: PASS — 8 new tests (22 total with permissions + warehouse schemas).

- [ ] **Step 5: Commit**

```bash
git add src/lib/lot-status.ts src/lib/lot-status.test.ts
git commit -m "feat(lots): lifecycle transition logic with unit tests"
```

---

### Task 2: The rules trigger (closes the Phase 1 gap)

**Files:**
- Create: `supabase/migrations/0011_lot_rules.sql`

**Interfaces:**
- Produces: trigger `lots_enforce_rules` (BEFORE UPDATE on `lots`). Rejects illegal transitions and over-capacity stores. Consumed by every write path.

> **Ordering:** this is `BEFORE UPDATE`; Phase 3's `lots_sync_movement` is `AFTER INSERT OR UPDATE`. Legality is therefore checked first, and movement history is only written for moves that were allowed.
>
> **Admin bypass:** returns early when `auth.uid() IS NULL` (seed / migrations / `service_role`). That context already bypasses RLS, so it is not subject to app rules. Without it, reseeding breaks.

- [ ] **Step 1: Write `supabase/migrations/0011_lot_rules.sql`**

```sql
-- Physical rules for a lot. These live in the database because Management can
-- UPDATE lots through RLS, so an app-only check could be skipped with a direct
-- PostgREST call. The UI offers only legal moves on top of this.
create or replace function public.enforce_lot_rules()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  order_of constant lot_status[] := array[
    'pending','in_transit','received','stored','dispatched','delivered'
  ]::lot_status[];
  old_idx int;
  new_idx int;
  delta int;
  free_mt numeric;
  shed_name text;
  shed_cap numeric;
begin
  -- Seed / migration / service_role context: already bypasses RLS, so it is
  -- not subject to app rules. Without this, reseeding cannot run.
  if auth.uid() is null then
    return new;
  end if;

  -- 1. Transition legality: next step for anyone, one step back for the Owner.
  if new.status is distinct from old.status then
    old_idx := array_position(order_of, old.status);
    new_idx := array_position(order_of, new.status);
    delta := new_idx - old_idx;

    if delta = 1 then
      null;                                   -- forward one: always allowed
    elsif delta = -1 and is_owner() then
      null;                                   -- owner correction
    else
      raise exception '% cannot move from % to %', new.lot_number, old.status, new.status
        using errcode = 'check_violation';
    end if;
  end if;

  -- 2. Capacity: a shed cannot hold more than it physically can.
  if new.status = 'stored' and new.shed_id is not null then
    select s.name, s.capacity_mt into shed_name, shed_cap
      from sheds s where s.id = new.shed_id;

    select shed_cap - coalesce(sum(l.quantity_mt), 0)
      into free_mt
      from lots l
     where l.shed_id = new.shed_id
       and l.status = 'stored'
       and l.id <> new.id;                    -- exclude this lot when re-saving

    if free_mt < new.quantity_mt then
      raise exception '% has % MT free; % is % MT',
        shed_name, trim(to_char(free_mt, 'FM999999990.###')),
        new.lot_number, trim(to_char(new.quantity_mt, 'FM999999990.###'))
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger lots_enforce_rules
  before update on public.lots
  for each row execute function public.enforce_lot_rules();
```

- [ ] **Step 2: Apply**

Run the `db push` block from Global Constraints.
Expected: `Applying migration 0011_lot_rules.sql...` then `Finished supabase db push.`

- [ ] **Step 3: Verify the trigger exists and the admin bypass works**

Run: `npx tsx scripts/db.ts "select tgname from pg_trigger where tgname='lots_enforce_rules'"`
Expected: one row.

Run: `npx tsx scripts/db.ts "select count(*)::int as ok from lots"` then reseed later — as `postgres`, `auth.uid()` is NULL so admin writes stay unrestricted. Confirm now:
```bash
npx tsx scripts/db.ts "update lots set status='pending' where lot_number=(select lot_number from lots where status='delivered' limit 1) returning lot_number, status"
```
Expected: succeeds (admin bypass) — a backward jump `delivered → pending` that an app user could never make.

Restore it:
```bash
npx tsx scripts/db.ts "update lots set status='delivered' where status='pending' and arrival_date is not null and dispatch_date is not null returning lot_number"
```

> The **app-user** path (where the rule actually bites) is proven end-to-end in Task 9 with a real Management session over the anon key — that is the only context where `auth.uid()` is set.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0011_lot_rules.sql
git commit -m "feat(db): enforce forward-only transitions and shed capacity"
```

---

### Task 3: Seed — make exceptions tell the truth

**Files:**
- Modify: `scripts/seed.ts`

**Interfaces:**
- Produces: `missing_bl` exceptions only on `in_transit` lots whose `bl_number IS NULL`; `missing_payment_terms` only on `export` lots whose `payment_terms IS NULL`.

> The Phase 1 seed stamped exception types onto random lots without checking the lot violates anything, so `missing_bl` sat on lots holding a B/L — reproducing the demo bug this phase exists to fix.

- [ ] **Step 1: Replace the exceptions block in `scripts/seed.ts`**

Find the `// 9. a few open exceptions on real lots` block and replace it entirely with:

```ts
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
```

- [ ] **Step 2: Reseed**

Run: `npm run seed`
Expected: `Seed complete → … lots: 100, lot_movements: 49, invoices: ~73, exceptions: 6`

- [ ] **Step 3: Verify every field-backed exception is now TRUE**

```bash
npx tsx scripts/db.ts "select count(*)::int as lying_exceptions from exceptions e join lots l on l.id=e.lot_id where (e.type='missing_bl' and l.bl_number is not null) or (e.type='missing_payment_terms' and l.payment_terms is not null)"
```
Expected: `lying_exceptions = 0`. **This is the check that proves the demo bug is gone.**

```bash
npx tsx scripts/db.ts "select e.type, l.lot_number, l.status, l.direction, l.bl_number, l.payment_terms from exceptions e join lots l on l.id=e.lot_id where e.type in ('missing_bl','missing_payment_terms')"
```
Expected: every `missing_bl` row has `bl_number: null`; every `missing_payment_terms` row has `payment_terms: null`.

- [ ] **Step 4: Confirm the Phase 3 invariant survived the reseed**

```bash
npx tsx scripts/db.ts "select (select count(*)::int from lot_movements where removed_at is null) as open_stays, (select count(*)::int from lots where status='stored') as stored_lots"
```
Expected: equal.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed.ts
git commit -m "fix(db): seed exceptions that reflect real violations"
```

---

### Task 4: Zod schemas (TDD)

**Files:**
- Create: `src/lib/schemas/lot.ts`, `src/lib/schemas/lot.test.ts`

**Interfaces:**
- Consumes: `LotStatus`, `statusIndex` (Task 1).
- Produces: `lotSchema` (Zod, with the conditional rules); `type LotInput`. Consumed by Tasks 6, 7.

- [ ] **Step 1: Write the failing test — `src/lib/schemas/lot.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { lotSchema } from "./lot";

const base = {
  direction: "import",
  commodity_id: "11111111-1111-1111-1111-111111111111",
  client_id: "22222222-2222-2222-2222-222222222222",
  quantity_mt: "500",
  status: "pending",
  origin_country: "India",
  vessel_name: "MV Test 1",
  bl_number: "",
  payment_terms: "LC",
  notes: "",
};

describe("lotSchema", () => {
  it("accepts a valid pending import with no B/L yet", () => {
    const r = lotSchema.safeParse(base);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.quantity_mt).toBe(500);
  });

  it("rejects zero or negative quantity", () => {
    expect(lotSchema.safeParse({ ...base, quantity_mt: "0" }).success).toBe(false);
    expect(lotSchema.safeParse({ ...base, quantity_mt: "-1" }).success).toBe(false);
  });

  // The paperwork doesn't exist until it sails: no B/L needed while pending,
  // required from in_transit onward.
  it("requires a B/L for an import at in_transit or later", () => {
    expect(lotSchema.safeParse({ ...base, status: "in_transit" }).success).toBe(false);
    expect(lotSchema.safeParse({ ...base, status: "stored" }).success).toBe(false);
    expect(
      lotSchema.safeParse({ ...base, status: "in_transit", bl_number: "BL-123" }).success,
    ).toBe(true);
  });

  it("does not require a B/L for exports", () => {
    expect(
      lotSchema.safeParse({
        ...base, direction: "export", status: "in_transit",
        destination_country: "Brazil", payment_terms: "TT",
      }).success,
    ).toBe(true);
  });

  it("requires payment terms for exports", () => {
    const r = lotSchema.safeParse({
      ...base, direction: "export", destination_country: "Brazil", payment_terms: "",
    });
    expect(r.success).toBe(false);
  });

  it("does not require payment terms for imports", () => {
    expect(lotSchema.safeParse({ ...base, payment_terms: "" }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./lot`.

- [ ] **Step 3: Implement `src/lib/schemas/lot.ts`**

```ts
import { z } from "zod";

import { statusIndex, type LotStatus } from "@/lib/lot-status";

const optionalText = z.string().trim().max(240).optional().default("");

/**
 * Shared by the form and the Server Actions. The conditional rules encode
 * CLAUDE.md's business rules: a B/L is required once an import is actually in
 * transit (not before — the paperwork doesn't exist until it sails), and an
 * export always needs agreed payment terms.
 */
export const lotSchema = z
  .object({
    direction: z.enum(["import", "export"]),
    commodity_id: z.string().uuid("Select a commodity"),
    client_id: z.string().uuid("Select a counterparty"),
    quantity_mt: z.coerce
      .number({ message: "Quantity must be a number" })
      .positive("Quantity must be greater than 0")
      .max(1_000_000, "Quantity looks too large"),
    status: z.enum([
      "pending", "in_transit", "received", "stored", "dispatched", "delivered",
    ]),
    origin_country: optionalText,
    destination_country: optionalText,
    vessel_name: optionalText,
    bl_number: optionalText,
    export_ref: optionalText,
    payment_terms: z.enum(["LC", "TT", "CAD", "DA"]).or(z.literal("")).optional().default(""),
    eta: z.string().trim().optional().default(""),
    notes: optionalText,
  })
  .superRefine((v, ctx) => {
    if (v.direction === "import" && statusIndex(v.status as LotStatus) >= statusIndex("in_transit")) {
      if (!v.bl_number) {
        ctx.addIssue({
          code: "custom",
          path: ["bl_number"],
          message: "B/L number is required once an import is in transit",
        });
      }
    }
    if (v.direction === "export" && !v.payment_terms) {
      ctx.addIssue({
        code: "custom",
        path: ["payment_terms"],
        message: "Payment terms are required for exports",
      });
    }
  });

export type LotInput = z.infer<typeof lotSchema>;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test`
Expected: PASS — 6 new tests (28 total).

- [ ] **Step 5: Commit**

```bash
git add src/lib/schemas/lot.ts src/lib/schemas/lot.test.ts
git commit -m "feat(lots): zod schema with conditional B/L and payment-terms rules"
```

---

### Task 5: Data layer

**Files:**
- Create: `src/lib/lots.ts`

**Interfaces:**
- Consumes: `createClient()` from `@/lib/supabase/server`; `LotStatus` (Task 1).
- Produces:
  - `type LotRow = { id, lot_number, direction, status, quantity_mt, bags, commodity, client, warehouse: string|null, shed: string|null, eta: string|null }`
  - `type LotDetail = LotRow & { commodity_id, client_id, warehouse_id, shed_id, origin_country, destination_country, vessel_name, bl_number, export_ref, payment_terms, arrival_date, dispatch_date, notes, market_value: number|null, bag_weight_kg }`
  - `type LotInvoice = { id, invoice_no, type, status, currency, amount, amount_paid, due_date }`
  - `type LotException = { id, type, severity, description, status, note, created_at }`
  - `listLots(opts: { q?, direction?, status?, page? }): Promise<{ rows: LotRow[]; total: number; statusCounts: Record<string, number> }>`
  - `getLot(id): Promise<LotDetail | null>`
  - `getLotInvoices(lotId): Promise<LotInvoice[]>`
  - `getLotExceptions(lotId): Promise<LotException[]>`
  - `listCommodities()`, `listClients()`, `listWarehousesWithSheds()`
  Consumed by Tasks 6–8.

- [ ] **Step 1: Create `src/lib/lots.ts`**

```ts
import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { LotStatus } from "@/lib/lot-status";

const num = (v: unknown): number => Number(v ?? 0);
export const PAGE_SIZE = 25;

export type LotRow = {
  id: string;
  lot_number: string;
  direction: "import" | "export";
  status: LotStatus;
  quantity_mt: number;
  bags: number;
  commodity: string;
  client: string;
  warehouse: string | null;
  shed: string | null;
  eta: string | null;
};

export type LotDetail = LotRow & {
  commodity_id: string;
  client_id: string;
  warehouse_id: string | null;
  shed_id: string | null;
  origin_country: string | null;
  destination_country: string | null;
  vessel_name: string | null;
  bl_number: string | null;
  export_ref: string | null;
  payment_terms: string | null;
  arrival_date: string | null;
  dispatch_date: string | null;
  notes: string | null;
  /** NULL for non-financial roles — masked by lots_view in the database. */
  market_value: number | null;
  bag_weight_kg: number;
};

export type LotInvoice = {
  id: string;
  invoice_no: string;
  type: "receivable" | "payable";
  status: string;
  currency: string;
  amount: number;
  amount_paid: number;
  due_date: string | null;
};

export type LotException = {
  id: string;
  type: string;
  severity: "critical" | "warning" | "notice";
  description: string;
  status: "open" | "resolved";
  note: string | null;
  created_at: string;
};

const LIST_SELECT =
  "id, lot_number, direction, status, quantity_mt, bags, eta, commodities!inner(name), clients!inner(name), warehouses(name), sheds(name)";

type ListRaw = {
  id: string; lot_number: string; direction: "import" | "export"; status: LotStatus;
  quantity_mt: unknown; bags: unknown; eta: string | null;
  commodities: { name: string }; clients: { name: string };
  warehouses: { name: string } | null; sheds: { name: string } | null;
};

function toRow(r: ListRaw): LotRow {
  return {
    id: r.id,
    lot_number: r.lot_number,
    direction: r.direction,
    status: r.status,
    quantity_mt: num(r.quantity_mt),
    bags: num(r.bags),
    commodity: r.commodities.name,
    client: r.clients.name,
    warehouse: r.warehouses?.name ?? null,
    shed: r.sheds?.name ?? null,
    eta: r.eta,
  };
}

/**
 * Reads lots_view (never the lots table) so market_value is masked by the
 * database for non-financial roles.
 */
export async function listLots(opts: {
  q?: string;
  direction?: string;
  status?: string;
  page?: number;
}): Promise<{ rows: LotRow[]; total: number; statusCounts: Record<string, number> }> {
  const supabase = await createClient();
  const page = Math.max(1, opts.page ?? 1);

  let query = supabase.from("lots_view").select(LIST_SELECT, { count: "exact" });

  if (opts.direction === "import" || opts.direction === "export") {
    query = query.eq("direction", opts.direction);
  }
  if (opts.status) query = query.eq("status", opts.status);
  if (opts.q?.trim()) {
    const term = `%${opts.q.trim()}%`;
    // Search the lot number directly, and the joined names via referenced tables.
    query = query.or(
      `lot_number.ilike.${term},commodities.name.ilike.${term},clients.name.ilike.${term}`,
    );
  }

  const from = (page - 1) * PAGE_SIZE;
  const { data, count, error } = await query
    .order("lot_number", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (error) throw new Error(`listLots: ${error.message}`);

  // Status tab counts respect the other active filters but not the status one.
  const countsQuery = supabase.from("lots_view").select("status");
  if (opts.direction === "import" || opts.direction === "export") {
    countsQuery.eq("direction", opts.direction);
  }
  const { data: allStatuses } = await countsQuery;
  const statusCounts: Record<string, number> = {};
  for (const r of allStatuses ?? []) {
    statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
  }

  return {
    rows: ((data ?? []) as unknown as ListRaw[]).map(toRow),
    total: count ?? 0,
    statusCounts,
  };
}

export async function getLot(id: string): Promise<LotDetail | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("lots_view")
    .select(
      "id, lot_number, direction, status, quantity_mt, bags, market_value, eta, arrival_date, dispatch_date, notes, origin_country, destination_country, vessel_name, bl_number, export_ref, payment_terms, commodity_id, client_id, warehouse_id, shed_id, commodities!inner(name, bag_weight_kg), clients!inner(name), warehouses(name), sheds(name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;

  const r = data as unknown as ListRaw & Record<string, unknown> & {
    commodities: { name: string; bag_weight_kg: unknown };
  };

  return {
    ...toRow(r),
    commodity_id: String(r.commodity_id),
    client_id: String(r.client_id),
    warehouse_id: (r.warehouse_id as string | null) ?? null,
    shed_id: (r.shed_id as string | null) ?? null,
    origin_country: (r.origin_country as string | null) ?? null,
    destination_country: (r.destination_country as string | null) ?? null,
    vessel_name: (r.vessel_name as string | null) ?? null,
    bl_number: (r.bl_number as string | null) ?? null,
    export_ref: (r.export_ref as string | null) ?? null,
    payment_terms: (r.payment_terms as string | null) ?? null,
    arrival_date: (r.arrival_date as string | null) ?? null,
    dispatch_date: (r.dispatch_date as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
    market_value: r.market_value == null ? null : num(r.market_value),
    bag_weight_kg: num(r.commodities.bag_weight_kg),
  };
}

/** RLS returns nothing here for Management — the mask is the database, not this code. */
export async function getLotInvoices(lotId: string): Promise<LotInvoice[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("invoices")
    .select("id, invoice_no, type, status, currency, amount, amount_paid, due_date")
    .eq("lot_id", lotId)
    .order("invoice_no");

  return (data ?? []).map((i) => ({
    ...i,
    amount: num(i.amount),
    amount_paid: num(i.amount_paid),
  })) as LotInvoice[];
}

export async function getLotExceptions(lotId: string): Promise<LotException[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("exceptions")
    .select("id, type, severity, description, status, note, created_at")
    .eq("lot_id", lotId)
    .order("created_at", { ascending: false });
  return (data ?? []) as LotException[];
}

export async function listCommodities() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("commodities_view")
    .select("id, name, bag_weight_kg")
    .order("name");
  return (data ?? []).map((c) => ({ ...c, bag_weight_kg: num(c.bag_weight_kg) }));
}

export async function listClients() {
  const supabase = await createClient();
  const { data } = await supabase.from("clients").select("id, name, type, country").order("name");
  return data ?? [];
}

/** Warehouses with their sheds and live free space, for the store picker. */
export async function listWarehousesWithSheds() {
  const supabase = await createClient();
  const { data: warehouses } = await supabase.from("warehouses").select("id, name").order("name");
  const { data: sheds } = await supabase
    .from("shed_occupancy")
    .select("shed_id, warehouse_id, name, capacity_mt, stored_mt")
    .order("name");

  return (warehouses ?? []).map((w) => ({
    ...w,
    sheds: (sheds ?? [])
      .filter((s) => s.warehouse_id === w.id)
      .map((s) => ({
        id: s.shed_id,
        name: s.name,
        free_mt: num(s.capacity_mt) - num(s.stored_mt),
      })),
  }));
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/lots.ts
git commit -m "feat(lots): server-only data layer reading lots_view"
```

---

### Task 6: Lots list

**Files:**
- Modify: `src/app/(app)/lots/page.tsx`
- Create: `src/app/(app)/lots/lot-filters.tsx`

**Interfaces:**
- Consumes: `listLots`, `PAGE_SIZE` (Task 5); `LOT_STATUSES`, `STATUS_LABELS` (Task 1).

> **Invoke the `frontend-design` skill** before the JSX. Dense operational table; mono for codes/quantities (that type system is already established).

- [ ] **Step 1: Add the shadcn primitive**

Run: `npx shadcn@latest add badge --yes`
Expected: creates `src/components/ui/badge.tsx`.

- [ ] **Step 2: Create `src/app/(app)/lots/lot-filters.tsx`**

```tsx
"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { LOT_STATUSES, STATUS_LABELS } from "@/lib/lot-status";

/**
 * Filters live in the URL so a filtered view is shareable and bookmarkable,
 * and the server does the filtering.
 */
export function LotFilters({ statusCounts }: { statusCounts: Record<string, number> }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [, startTransition] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    next.delete("page"); // any filter change resets paging
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  };

  const direction = params.get("direction") ?? "";
  const status = params.get("status") ?? "";

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <form
          className="relative flex-1 min-w-56"
          onSubmit={(e) => {
            e.preventDefault();
            set({ q });
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search lot number, commodity, counterparty…"
            className="pl-9"
            aria-label="Search lots"
          />
        </form>

        <div className="flex items-center gap-1 rounded-lg border p-0.5">
          {[
            { value: "", label: "All" },
            { value: "import", label: "Import" },
            { value: "export", label: "Export" },
          ].map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => set({ direction: o.value || null })}
              className={cn(
                "rounded-md px-3 py-1 text-sm transition-colors",
                direction === o.value
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b pb-2">
        <button
          type="button"
          onClick={() => set({ status: null })}
          className={cn(
            "rounded-md px-2.5 py-1 text-sm transition-colors",
            !status ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          All
        </button>
        {LOT_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => set({ status: s })}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors",
              status === s ? "bg-accent font-medium text-accent-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {STATUS_LABELS[s]}
            <span className="font-mono text-[0.6875rem] text-muted-foreground">
              {statusCounts[s] ?? 0}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `src/app/(app)/lots/page.tsx`**

```tsx
import Link from "next/link";
import { Plus } from "lucide-react";

import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { can } from "@/lib/permissions";
import { listLots, PAGE_SIZE } from "@/lib/lots";
import { STATUS_LABELS } from "@/lib/lot-status";
import { buttonVariants } from "@/components/ui/button";
import { LotFilters } from "./lot-filters";

export default async function LotsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; direction?: string; status?: string; page?: string }>;
}) {
  const gate = await requireCapability("view_operations");
  if (!gate.allowed) return <BlockedScreen required="view_operations" role={gate.role} />;

  const sp = await searchParams;
  const page = Number(sp.page ?? 1) || 1;
  const { rows, total, statusCounts } = await listLots({
    q: sp.q, direction: sp.direction, status: sp.status, page,
  });

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (p: number) => {
    const next = new URLSearchParams();
    if (sp.q) next.set("q", sp.q);
    if (sp.direction) next.set("direction", sp.direction);
    if (sp.status) next.set("status", sp.status);
    next.set("page", String(p));
    return `/lots?${next.toString()}`;
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Lots</h1>
          <p className="text-sm text-muted-foreground">
            {total.toLocaleString("en-US")} lot{total === 1 ? "" : "s"} across every stage of the lifecycle.
          </p>
        </div>
        {can(gate.session.profile.role, "manage_lots") ? (
          <Link href="/lots/new" className={buttonVariants({ size: "sm", className: "gap-1.5" })}>
            <Plus className="size-4" />
            New lot
          </Link>
        ) : null}
      </div>

      <LotFilters statusCounts={statusCounts} />

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm font-medium">No lots match these filters</p>
          <p className="mt-1 text-sm text-muted-foreground">Try clearing the search or status filter.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-left font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Lot</th>
                <th className="px-4 py-2.5 font-medium">Dir</th>
                <th className="px-4 py-2.5 font-medium">Commodity</th>
                <th className="px-4 py-2.5 font-medium">Counterparty</th>
                <th className="px-4 py-2.5 text-right font-medium">Quantity</th>
                <th className="px-4 py-2.5 text-right font-medium">Bags</th>
                <th className="px-4 py-2.5 font-medium">Location</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l) => (
                <tr key={l.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2.5">
                    <Link href={`/lots/${l.id}`} className="font-mono text-xs underline-offset-4 hover:underline">
                      {l.lot_number}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                      {l.direction === "import" ? "IMP" : "EXP"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">{l.commodity}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{l.client}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {l.quantity_mt.toLocaleString("en-US")} MT
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                    {l.bags.toLocaleString("en-US")}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {l.shed ? `${l.warehouse} · ${l.shed}` : (l.warehouse ?? "—")}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                      {STATUS_LABELS[l.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          <div className="flex gap-2">
            {page > 1 ? (
              <Link href={qs(page - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                Previous
              </Link>
            ) : null}
            {page < pages ? (
              <Link href={qs(page + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                Next
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Verify against SQL**

Run `npm run dev`, sign in as Owner, open `/lots`.
Expected: 100 total; status tabs show 17/17/17/17/16/16; rows show mono lot numbers, MT and bags.

Cross-check bags for the first row:
```bash
npx tsx scripts/db.ts "select lot_number, quantity_mt, bags from lots_view order by lot_number desc limit 3"
```
Expected: matches the table exactly.

Check the filters drive the URL: click Export → `?direction=export`; click Stored → `?direction=export&status=stored`; search a lot number → `?q=…`. Each narrows the rows and survives a reload.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/lots/page.tsx" "src/app/(app)/lots/lot-filters.tsx" src/components/ui/badge.tsx
git commit -m "feat(lots): list with URL-driven search, filters and pagination"
```

---

### Task 7: Server Actions + create/edit form

**Files:**
- Create: `src/app/(app)/lots/actions.ts`, `src/app/(app)/lots/lot-form.tsx`
- Modify: `src/app/(app)/lots/new/page.tsx`, `src/app/(app)/lots/[id]/edit/page.tsx`

**Interfaces:**
- Consumes: `lotSchema` (Task 4), `writeAudit` (Phase 3), `requireCapability`, data layer (Task 5).
- Produces: `type LotActionState = { error: string | null; fieldErrors?: Record<string,string>; ok?: boolean }`; `saveLot(prev, formData)`. Consumed by Task 8's stepper too.

> **Invoke `frontend-design`** before the JSX. Inputs MUST be controlled (React 19 resets uncontrolled forms after an action — Phase 3 lesson).

- [ ] **Step 1: Create `src/app/(app)/lots/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { lotSchema } from "@/lib/schemas/lot";

export type LotActionState = {
  error: string | null;
  fieldErrors?: Record<string, string>;
  ok?: boolean;
  lotId?: string;
};

function zodFieldErrors(issues: { path: PropertyKey[]; message: string }[]) {
  const fieldErrors: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  return fieldErrors;
}

/** Empty string → NULL, so optional columns stay null rather than "". */
const nz = (v: string | undefined) => (v && v.trim() ? v.trim() : null);

export async function saveLot(_prev: LotActionState, formData: FormData): Promise<LotActionState> {
  const gate = await requireCapability("manage_lots");
  if (!gate.allowed) return { error: "You do not have permission to edit lots." };

  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();

  // Status is NEVER read from the form. A client could post status=pending on
  // an in-transit import to dodge the B/L requirement — defeating the rule this
  // phase exists to enforce. New lots are pending by definition; edits use
  // whatever the database currently says.
  let currentStatus = "pending";
  if (id) {
    const { data: existing } = await supabase
      .from("lots")
      .select("status")
      .eq("id", id)
      .maybeSingle();
    if (!existing) return { error: "Lot not found." };
    currentStatus = existing.status;
  }

  const parsed = lotSchema.safeParse({
    direction: formData.get("direction"),
    commodity_id: formData.get("commodity_id"),
    client_id: formData.get("client_id"),
    quantity_mt: formData.get("quantity_mt"),
    status: currentStatus,
    origin_country: formData.get("origin_country"),
    destination_country: formData.get("destination_country"),
    vessel_name: formData.get("vessel_name"),
    bl_number: formData.get("bl_number"),
    export_ref: formData.get("export_ref"),
    payment_terms: formData.get("payment_terms"),
    eta: formData.get("eta"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) return { error: null, fieldErrors: zodFieldErrors(parsed.error.issues) };

  const v = parsed.data;
  const row = {
    direction: v.direction,
    commodity_id: v.commodity_id,
    client_id: v.client_id,
    quantity_mt: v.quantity_mt,
    origin_country: nz(v.origin_country),
    destination_country: nz(v.destination_country),
    vessel_name: nz(v.vessel_name),
    bl_number: nz(v.bl_number),
    export_ref: nz(v.export_ref),
    payment_terms: v.payment_terms ? v.payment_terms : null,
    eta: nz(v.eta),
    notes: nz(v.notes),
  };

  if (id) {
    const { data: before } = await supabase.from("lots").select("*").eq("id", id).maybeSingle();
    const { error } = await supabase.from("lots").update(row).eq("id", id);
    if (error) return { error: error.message };

    await writeAudit("update", "lot", id, { before, after: row });
    await autoResolveFieldExceptions(id, gate.session.user.id);

    revalidatePath(`/lots/${id}`);
    revalidatePath("/lots");
    return { error: null, ok: true, lotId: id };
  }

  const { data, error } = await supabase
    .from("lots")
    .insert({ ...row, status: "pending", created_by: gate.session.user.id })
    .select("id, lot_number")
    .single();
  if (error) return { error: error.message };

  await writeAudit("create", "lot", data.id, { after: { ...row, lot_number: data.lot_number } });

  revalidatePath("/lots");
  return { error: null, ok: true, lotId: data.id };
}

/**
 * CLAUDE.md: "Resolving = filling the field or explicitly resolving with a
 * note." So filling a B/L closes an open missing_bl, and setting payment terms
 * closes an open missing_payment_terms.
 */
export async function autoResolveFieldExceptions(lotId: string, userId: string): Promise<void> {
  const supabase = await createClient();
  const { data: lot } = await supabase
    .from("lots")
    .select("bl_number, payment_terms")
    .eq("id", lotId)
    .maybeSingle();
  if (!lot) return;

  const nowResolved: string[] = [];
  if (lot.bl_number) nowResolved.push("missing_bl");
  if (lot.payment_terms) nowResolved.push("missing_payment_terms");
  if (nowResolved.length === 0) return;

  const { data: closed } = await supabase
    .from("exceptions")
    .update({
      status: "resolved",
      resolved_by: userId,
      resolved_at: new Date().toISOString(),
      note: "Automatically resolved: the missing field was filled in.",
    })
    .eq("lot_id", lotId)
    .eq("status", "open")
    .in("type", nowResolved)
    .select("id, type");

  for (const e of closed ?? []) {
    await writeAudit("resolve", "exception", e.id, { type: e.type, auto: true, lot_id: lotId });
  }
}
```

- [ ] **Step 2: Create `src/app/(app)/lots/lot-form.tsx`**

```tsx
"use client";

import { useActionState, useEffect, useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { saveLot, type LotActionState } from "./actions";

const labelClass = "font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground";

type Option = { id: string; name: string };
type Commodity = Option & { bag_weight_kg: number };

export type LotFormValues = {
  id?: string;
  direction: "import" | "export";
  status: string;
  commodity_id: string;
  client_id: string;
  quantity_mt: string;
  origin_country: string;
  destination_country: string;
  vessel_name: string;
  bl_number: string;
  export_ref: string;
  payment_terms: string;
  eta: string;
  notes: string;
};

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : isEdit ? "Save changes" : "Create lot"}
    </Button>
  );
}

export function LotForm({
  commodities,
  clients,
  initial,
}: {
  commodities: Commodity[];
  clients: Option[];
  initial: LotFormValues;
}) {
  const isEdit = Boolean(initial.id);
  const router = useRouter();
  const [state, formAction] = useActionState<LotActionState, FormData>(saveLot, { error: null });

  // Controlled: React 19 resets an uncontrolled form once the action completes,
  // which would wipe everything the user typed on a validation error.
  const [v, setV] = useState<LotFormValues>(initial);
  const set = <K extends keyof LotFormValues>(k: K, val: LotFormValues[K]) =>
    setV((prev) => ({ ...prev, [k]: val }));

  useEffect(() => {
    if (state.ok && state.lotId) router.push(`/lots/${state.lotId}`);
  }, [state, router]);

  // bags = quantity_mt * 1000 / bag_weight_kg — derived, shown live, never stored.
  const bags = useMemo(() => {
    const c = commodities.find((x) => x.id === v.commodity_id);
    const qty = Number(v.quantity_mt);
    if (!c || !Number.isFinite(qty) || qty <= 0 || !c.bag_weight_kg) return null;
    return Math.round((qty * 1000) / c.bag_weight_kg);
  }, [commodities, v.commodity_id, v.quantity_mt]);

  const isImport = v.direction === "import";

  return (
    <form action={formAction} className="flex flex-col gap-6">
      {/* No status field, hidden or otherwise: the server reads the lot's
          current status from the database. Sending it from here would let a
          client dodge the conditional B/L rule. */}
      {initial.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <input type="hidden" name="direction" value={v.direction} />

      <div className="flex items-center gap-1 rounded-lg border p-0.5 w-fit">
        {(["import", "export"] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => set("direction", d)}
            className={cn(
              "rounded-md px-4 py-1.5 text-sm capitalize transition-colors",
              v.direction === d
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {d}
          </button>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Commodity" error={state.fieldErrors?.commodity_id}>
          <select
            name="commodity_id"
            value={v.commodity_id}
            onChange={(e) => set("commodity_id", e.target.value)}
            className="h-9 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            required
          >
            <option value="">Select a commodity</option>
            {commodities.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>

        <Field label="Counterparty" error={state.fieldErrors?.client_id}>
          <select
            name="client_id"
            value={v.client_id}
            onChange={(e) => set("client_id", e.target.value)}
            className="h-9 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            required
          >
            <option value="">Select a counterparty</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>

        <Field
          label="Quantity (MT)"
          error={state.fieldErrors?.quantity_mt}
          hint={bags != null ? `${bags.toLocaleString("en-US")} bags` : undefined}
        >
          <Input
            name="quantity_mt"
            type="number"
            step="0.001"
            min="0"
            value={v.quantity_mt}
            onChange={(e) => set("quantity_mt", e.target.value)}
            required
          />
        </Field>

        <Field label="ETA">
          <Input name="eta" type="date" value={v.eta} onChange={(e) => set("eta", e.target.value)} />
        </Field>

        {isImport ? (
          <>
            <Field label="Origin country">
              <Input
                name="origin_country"
                value={v.origin_country}
                onChange={(e) => set("origin_country", e.target.value)}
              />
            </Field>
            <Field label="Vessel">
              <Input
                name="vessel_name"
                value={v.vessel_name}
                onChange={(e) => set("vessel_name", e.target.value)}
              />
            </Field>
            <Field
              label="B/L number"
              error={state.fieldErrors?.bl_number}
              hint="Required once in transit"
            >
              <Input
                name="bl_number"
                value={v.bl_number}
                onChange={(e) => set("bl_number", e.target.value)}
              />
            </Field>
          </>
        ) : (
          <>
            <Field label="Destination country">
              <Input
                name="destination_country"
                value={v.destination_country}
                onChange={(e) => set("destination_country", e.target.value)}
              />
            </Field>
            <Field label="Export reference">
              <Input
                name="export_ref"
                value={v.export_ref}
                onChange={(e) => set("export_ref", e.target.value)}
              />
            </Field>
            <Field label="Payment terms" error={state.fieldErrors?.payment_terms}>
              <select
                name="payment_terms"
                value={v.payment_terms}
                onChange={(e) => set("payment_terms", e.target.value)}
                className="h-9 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="">Select terms</option>
                {["LC", "TT", "CAD", "DA"].map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </Field>
          </>
        )}
      </div>

      <Field label="Notes">
        <Input name="notes" value={v.notes} onChange={(e) => set("notes", e.target.value)} />
      </Field>

      {state.error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={() => router.back()}>
          Cancel
        </Button>
        <SubmitButton isEdit={isEdit} />
      </div>
    </form>
  );
}

function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label className={labelClass}>{label}</Label>
        {hint ? <span className="font-mono text-[0.6875rem] text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `src/app/(app)/lots/new/page.tsx`**

```tsx
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { listCommodities, listClients } from "@/lib/lots";
import { LotForm } from "../lot-form";

export default async function NewLotPage() {
  const gate = await requireCapability("manage_lots");
  if (!gate.allowed) return <BlockedScreen required="manage_lots" role={gate.role} />;

  const [commodities, clients] = await Promise.all([listCommodities(), listClients()]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Link href="/lots" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        Lots
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">New lot</h1>
        <p className="text-sm text-muted-foreground">
          The lot number is assigned automatically. New lots start as Pending.
        </p>
      </div>
      <LotForm
        commodities={commodities}
        clients={clients}
        initial={{
          direction: "import", status: "pending", commodity_id: "", client_id: "",
          quantity_mt: "", origin_country: "", destination_country: "", vessel_name: "",
          bl_number: "", export_ref: "", payment_terms: "", eta: "", notes: "",
        }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `src/app/(app)/lots/[id]/edit/page.tsx`**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { getLot, listCommodities, listClients } from "@/lib/lots";
import { LotForm } from "../../lot-form";

export default async function EditLotPage({ params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("manage_lots");
  if (!gate.allowed) return <BlockedScreen required="manage_lots" role={gate.role} />;

  const { id } = await params;
  const lot = await getLot(id);
  if (!lot) notFound();

  const [commodities, clients] = await Promise.all([listCommodities(), listClients()]);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <Link href={`/lots/${id}`} className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        {lot.lot_number}
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Edit {lot.lot_number}</h1>
        <p className="text-sm text-muted-foreground">
          Status changes happen on the lot page, not here.
        </p>
      </div>
      <LotForm
        commodities={commodities}
        clients={clients}
        initial={{
          id: lot.id,
          direction: lot.direction,
          status: lot.status,
          commodity_id: lot.commodity_id,
          client_id: lot.client_id,
          quantity_mt: String(lot.quantity_mt),
          origin_country: lot.origin_country ?? "",
          destination_country: lot.destination_country ?? "",
          vessel_name: lot.vessel_name ?? "",
          bl_number: lot.bl_number ?? "",
          export_ref: lot.export_ref ?? "",
          payment_terms: lot.payment_terms ?? "",
          eta: lot.eta ?? "",
          notes: lot.notes ?? "",
        }}
      />
    </div>
  );
}
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` → exit 0.

As Owner, `/lots/new`:
- Toggle Import/Export → field sets swap.
- Pick a commodity + type 500 → bags hint appears live and matches `500 * 1000 / bag_weight_kg`.
- Export with no payment terms → submit → inline "Payment terms are required for exports"; **the form keeps every value**.
- Fix and submit → redirected to the new lot's detail page; it is Pending.

Confirm the audit entry:
```bash
npx tsx scripts/db.ts "select seq, action, entity_type from audit_log order by seq desc limit 2"
```
Expected: a `create` / `lot` row.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/lots/actions.ts" "src/app/(app)/lots/lot-form.tsx" "src/app/(app)/lots/new/page.tsx" "src/app/(app)/lots/[id]/edit/page.tsx"
git commit -m "feat(lots): create/edit form with zod validation and live bags"
```

---

### Task 8: Lot Detail — stepper, cards, gated invoices, resolvable exceptions

**Files:**
- Modify: `src/app/(app)/lots/[id]/page.tsx`, `src/app/(app)/lots/actions.ts`
- Create: `src/app/(app)/lots/[id]/status-stepper.tsx`, `src/app/(app)/lots/[id]/exception-list.tsx`

**Interfaces:**
- Consumes: `getLot`, `getLotInvoices`, `getLotExceptions`, `listWarehousesWithSheds` (Task 5); `allowedTransitions`, `STATUS_LABELS`, `LOT_STATUSES` (Task 1).
- Produces: `transitionLot(prev, formData)`, `resolveException(prev, formData)` in `actions.ts`.

> **Invoke `frontend-design`** before the JSX. This screen fixes two named demo bugs, so the exceptions and the transition controls must be unmistakably present and usable.

- [ ] **Step 1: Append the transition + resolve actions to `src/app/(app)/lots/actions.ts`**

```ts
import { allowedTransitions, type LotStatus } from "@/lib/lot-status";

/**
 * The database trigger is the enforcement mechanism; this check exists to give
 * a clean message and to stop an illegal move before it reaches SQL.
 */
export async function transitionLot(_prev: LotActionState, formData: FormData): Promise<LotActionState> {
  const gate = await requireCapability("manage_lots");
  if (!gate.allowed) return { error: "You do not have permission to change lot status." };

  const id = String(formData.get("id") ?? "");
  const to = String(formData.get("to") ?? "") as LotStatus;
  const shedId = String(formData.get("shed_id") ?? "");
  if (!id || !to) return { error: "Missing lot or target status." };

  const supabase = await createClient();
  const { data: lot } = await supabase
    .from("lots")
    .select("id, lot_number, status, direction, bl_number, quantity_mt, shed_id, warehouse_id")
    .eq("id", id)
    .maybeSingle();
  if (!lot) return { error: "Lot not found." };

  const isOwner = gate.session.profile.role === "owner";
  if (!allowedTransitions(lot.status as LotStatus, isOwner).includes(to)) {
    return { error: `${lot.lot_number} cannot move from ${lot.status} to ${to}.` };
  }

  // CLAUDE.md: an import in transit must have its B/L recorded.
  if (to === "in_transit" && lot.direction === "import" && !lot.bl_number) {
    return { error: "Record the B/L number before marking this import in transit." };
  }

  const patch: Record<string, unknown> = { status: to, updated_at: new Date().toISOString() };

  if (to === "stored") {
    if (!shedId) return { error: "Choose a shed to store this lot in." };
    const { data: shed } = await supabase
      .from("sheds")
      .select("id, warehouse_id")
      .eq("id", shedId)
      .maybeSingle();
    if (!shed) return { error: "That shed no longer exists." };
    patch.shed_id = shedId;
    patch.warehouse_id = shed.warehouse_id;
    patch.arrival_date = patch.arrival_date ?? new Date().toISOString().slice(0, 10);
  }
  if (to === "dispatched") patch.dispatch_date = new Date().toISOString().slice(0, 10);

  const { error } = await supabase.from("lots").update(patch).eq("id", id);
  if (error) {
    // The trigger's message is written for humans — surface it as-is rather
    // than a raw Postgres error.
    return { error: error.message.replace(/^.*?violates.*?:\s*/i, "") };
  }

  await writeAudit("transition", "lot", id, { from: lot.status, to, shed_id: shedId || null });

  revalidatePath(`/lots/${id}`);
  revalidatePath("/lots");
  revalidatePath("/warehouses");
  return { error: null, ok: true };
}

export async function resolveException(_prev: LotActionState, formData: FormData): Promise<LotActionState> {
  const gate = await requireCapability("manage_lots");
  if (!gate.allowed) return { error: "You do not have permission to resolve exceptions." };

  const id = String(formData.get("id") ?? "");
  const lotId = String(formData.get("lot_id") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!note) return { error: null, fieldErrors: { note: "Add a note explaining the resolution." } };

  const supabase = await createClient();
  const { error } = await supabase
    .from("exceptions")
    .update({
      status: "resolved",
      note,
      resolved_by: gate.session.user.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) return { error: error.message };

  await writeAudit("resolve", "exception", id, { note, auto: false, lot_id: lotId });

  revalidatePath(`/lots/${lotId}`);
  return { error: null, ok: true };
}
```

> `autoResolveFieldExceptions(lotId, userId)` is already defined in Task 7 with
> the user id passed in from `saveLot` — nothing further to change here.

- [ ] **Step 2: Create `src/app/(app)/lots/[id]/status-stepper.tsx`**

```tsx
"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, ChevronRight, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { LOT_STATUSES, STATUS_LABELS, statusIndex, type LotStatus } from "@/lib/lot-status";
import { transitionLot, type LotActionState } from "../actions";

type Shed = { id: string; name: string; free_mt: number };
type Warehouse = { id: string; name: string; sheds: Shed[] };

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? "Working…" : label}</Button>;
}

export function StatusStepper({
  lotId,
  current,
  transitions,
  warehouses,
}: {
  lotId: string;
  current: LotStatus;
  transitions: LotStatus[];
  warehouses: Warehouse[];
}) {
  const [state, formAction] = useActionState<LotActionState, FormData>(transitionLot, { error: null });
  const [storeOpen, setStoreOpen] = useState(false);
  const [shedId, setShedId] = useState("");
  const currentIdx = statusIndex(current);

  const forward = transitions.find((t) => statusIndex(t) > currentIdx);
  const back = transitions.find((t) => statusIndex(t) < currentIdx);

  return (
    <div className="flex flex-col gap-4 rounded-xl border p-5">
      <ol className="flex flex-wrap items-center gap-1">
        {LOT_STATUSES.map((s, i) => {
          const done = i < currentIdx;
          const active = i === currentIdx;
          return (
            <li key={s} className="flex items-center gap-1">
              <span
                className={cn(
                  "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
                  active && "bg-primary text-primary-foreground",
                  done && "text-muted-foreground",
                  !active && !done && "text-muted-foreground/50",
                )}
              >
                {done ? <Check className="size-3" /> : null}
                {STATUS_LABELS[s]}
              </span>
              {i < LOT_STATUSES.length - 1 ? (
                <ChevronRight className="size-3 text-muted-foreground/40" />
              ) : null}
            </li>
          );
        })}
      </ol>

      {state.error ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.error}
        </p>
      ) : null}

      {transitions.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          {forward ? (
            forward === "stored" ? (
              <Button size="sm" onClick={() => setStoreOpen(true)}>
                Mark as Stored…
              </Button>
            ) : (
              <form action={formAction}>
                <input type="hidden" name="id" value={lotId} />
                <input type="hidden" name="to" value={forward} />
                <SubmitButton label={`Mark as ${STATUS_LABELS[forward]}`} />
              </form>
            )
          ) : null}

          {back ? (
            <form action={formAction}>
              <input type="hidden" name="id" value={lotId} />
              <input type="hidden" name="to" value={back} />
              <Button type="submit" variant="outline" size="sm" className="gap-1.5">
                <Undo2 className="size-3.5" />
                Back to {STATUS_LABELS[back]}
              </Button>
            </form>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">This lot has completed its lifecycle.</p>
      )}

      {/* Storing needs a destination, so this is the one transition that asks a
          question first. The DB trigger is still the backstop on capacity. */}
      <Dialog open={storeOpen} onOpenChange={setStoreOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle>Store this lot</DialogTitle>
          <DialogDescription>Choose a shed with room for it.</DialogDescription>
          <form action={formAction} className="mt-2 flex flex-col gap-4">
            <input type="hidden" name="id" value={lotId} />
            <input type="hidden" name="to" value="stored" />
            <select
              name="shed_id"
              value={shedId}
              onChange={(e) => setShedId(e.target.value)}
              className="h-9 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              required
            >
              <option value="">Select a shed</option>
              {warehouses.map((w) => (
                <optgroup key={w.id} label={w.name}>
                  {w.sheds.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} — {s.free_mt.toLocaleString("en-US")} MT free
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setStoreOpen(false)}>
                Cancel
              </Button>
              <SubmitButton label="Store lot" />
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/app/(app)/lots/[id]/exception-list.tsx`**

```tsx
"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { resolveException, type LotActionState } from "../actions";
import type { LotException } from "@/lib/lots";

const SEVERITY: Record<string, { cls: string; label: string }> = {
  critical: { cls: "bg-[#d03b3b]/10 text-[#d03b3b]", label: "Critical" },
  warning: { cls: "bg-[#fab219]/15 text-[#8a5d00] dark:text-[#fab219]", label: "Warning" },
  notice: { cls: "bg-muted text-muted-foreground", label: "Notice" },
};

const TYPE_LABELS: Record<string, string> = {
  weight_shortage: "Weight shortage",
  missing_bl: "Missing B/L",
  missing_payment_terms: "Missing payment terms",
  compliance_block: "Compliance block",
  overdue_invoice: "Overdue invoice",
  low_capacity: "Low capacity",
};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? "Resolving…" : "Resolve"}
    </Button>
  );
}

export function ExceptionList({
  lotId,
  exceptions,
  canResolve,
}: {
  lotId: string;
  exceptions: LotException[];
  canResolve: boolean;
}) {
  const open = exceptions.filter((e) => e.status === "open");
  const resolved = exceptions.filter((e) => e.status === "resolved");

  if (exceptions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-6 text-center">
        <p className="text-sm font-medium">No exceptions</p>
        <p className="mt-1 text-sm text-muted-foreground">Nothing is flagged against this lot.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {open.map((e) => (
        <ExceptionCard key={e.id} lotId={lotId} exception={e} canResolve={canResolve} />
      ))}
      {resolved.map((e) => (
        <div key={e.id} className="rounded-xl border bg-muted/30 p-4 opacity-70">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{TYPE_LABELS[e.type] ?? e.type}</span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-xs">Resolved</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{e.description}</p>
          {e.note ? <p className="mt-2 text-xs text-muted-foreground">Note: {e.note}</p> : null}
        </div>
      ))}
    </div>
  );
}

function ExceptionCard({
  lotId,
  exception,
  canResolve,
}: {
  lotId: string;
  exception: LotException;
  canResolve: boolean;
}) {
  const [state, formAction] = useActionState<LotActionState, FormData>(resolveException, { error: null });
  const [note, setNote] = useState("");
  const sev = SEVERITY[exception.severity] ?? SEVERITY.notice;

  return (
    <div className="flex flex-col gap-3 rounded-xl border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{TYPE_LABELS[exception.type] ?? exception.type}</span>
            {/* Icon+label, never colour alone. */}
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", sev.cls)}>
              {sev.label}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{exception.description}</p>
        </div>
      </div>

      {canResolve ? (
        <form action={formAction} className="flex flex-col gap-2">
          <input type="hidden" name="id" value={exception.id} />
          <input type="hidden" name="lot_id" value={lotId} />
          <div className="flex gap-2">
            <Input
              name="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="How was this resolved?"
              className="h-9"
            />
            <SubmitButton />
          </div>
          {state.fieldErrors?.note ? (
            <p className="text-xs text-destructive">{state.fieldErrors.note}</p>
          ) : null}
          {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
        </form>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Rewrite `src/app/(app)/lots/[id]/page.tsx`**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { can } from "@/lib/permissions";
import { buttonVariants } from "@/components/ui/button";
import {
  getLot, getLotInvoices, getLotExceptions, listWarehousesWithSheds,
} from "@/lib/lots";
import { allowedTransitions, STATUS_LABELS } from "@/lib/lot-status";
import { StatusStepper } from "./status-stepper";
import { ExceptionList } from "./exception-list";

const money = (n: number, ccy: string) =>
  `${ccy} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default async function LotDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("view_operations");
  if (!gate.allowed) return <BlockedScreen required="view_operations" role={gate.role} />;

  const { id } = await params;
  const lot = await getLot(id);
  if (!lot) notFound();

  const role = gate.session.profile.role;
  const isOwner = role === "owner";
  const showMoney = can(role, "view_financials");
  const canEdit = can(role, "manage_lots");

  const [invoices, exceptions, warehouses] = await Promise.all([
    // Not merely hidden: for Management RLS returns nothing anyway.
    showMoney ? getLotInvoices(id) : Promise.resolve([]),
    getLotExceptions(id),
    canEdit ? listWarehousesWithSheds() : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Link href="/lots" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        Lots
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <h1 className="font-mono text-2xl font-semibold tracking-tight">{lot.lot_number}</h1>
            <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
              {lot.direction}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {lot.commodity} · {lot.quantity_mt.toLocaleString("en-US")} MT ·{" "}
            {lot.bags.toLocaleString("en-US")} bags
          </p>
        </div>
        {canEdit ? (
          <Link href={`/lots/${id}/edit`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Edit
          </Link>
        ) : null}
      </div>

      {canEdit ? (
        <StatusStepper
          lotId={lot.id}
          current={lot.status}
          transitions={allowedTransitions(lot.status, isOwner)}
          warehouses={warehouses}
        />
      ) : (
        <div className="rounded-xl border p-5">
          <span className="text-sm">
            Status: <span className="font-medium">{STATUS_LABELS[lot.status]}</span>
          </span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Card title="Shipment">
          <Row label="Vessel" value={lot.vessel_name} />
          <Row label="B/L number" value={lot.bl_number} mono />
          <Row label="Export ref" value={lot.export_ref} mono />
          <Row label="Payment terms" value={lot.payment_terms} />
          <Row label="ETA" value={lot.eta} />
        </Card>

        <Card title="Storage">
          <Row label="Warehouse" value={lot.warehouse} />
          <Row label="Shed" value={lot.shed} />
          <Row label="Arrived" value={lot.arrival_date} />
          <Row label="Dispatched" value={lot.dispatch_date} />
        </Card>

        <Card title="Counterparty">
          <Row label="Name" value={lot.client} />
          <Row label="Origin" value={lot.origin_country} />
          <Row label="Destination" value={lot.destination_country} />
        </Card>

        <Card title="Commodity">
          <Row label="Name" value={lot.commodity} />
          <Row label="Quantity" value={`${lot.quantity_mt.toLocaleString("en-US")} MT`} />
          <Row label="Bags" value={`${lot.bags.toLocaleString("en-US")} @ ${lot.bag_weight_kg} kg`} />
          {showMoney && lot.market_value != null ? (
            <Row label="Market value" value={money(lot.market_value, "USD")} />
          ) : null}
        </Card>
      </div>

      {/* The demo gap fix: exceptions are real records, shown here, resolvable. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Exceptions</h2>
        <ExceptionList lotId={lot.id} exceptions={exceptions} canResolve={canEdit} />
      </section>

      {showMoney ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Invoices</h2>
          {invoices.length === 0 ? (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              No invoices raised against this lot.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr className="text-left font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Invoice</th>
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                    <th className="px-4 py-2.5 text-right font-medium">Paid</th>
                    <th className="px-4 py-2.5 font-medium">Due</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.id} className="border-b last:border-0">
                      <td className="px-4 py-2.5 font-mono text-xs">{i.invoice_no}</td>
                      <td className="px-4 py-2.5">{i.type === "receivable" ? "AR" : "AP"}</td>
                      <td className="px-4 py-2.5 capitalize text-muted-foreground">{i.status}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{money(i.amount, i.currency)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                        {money(i.amount_paid, i.currency)}
                      </td>
                      <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{i.due_date ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border p-5">
      <h2 className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      <dl className="flex flex-col gap-2">{children}</dl>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-xs" : "text-sm"}>{value || "—"}</dd>
    </div>
  );
}
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` → exit 0.

As Owner on a `pending` lot: stepper shows the lifecycle with Pending highlighted and exactly one action ("Mark as In Transit"). On a `stored` lot: two actions (Mark as Dispatched; Back to Received).

On a lot with an open `missing_bl`: the exception card is visible with the Warning badge; resolving with a note marks it resolved.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/lots/[id]" "src/app/(app)/lots/actions.ts"
git commit -m "feat(lots): detail with status stepper, gated invoices, resolvable exceptions"
```

---

### Task 9: Acceptance verification

**Files:**
- Create: `scripts/verify-lot-rules.ts`

- [ ] **Step 1: Create `scripts/verify-lot-rules.ts`**

```ts
import { config } from "dotenv";
config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

/**
 * Proves the DATABASE enforces the lot rules and leaks no money — bypassing the
 * UI entirely, as a real API caller would.
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
  const { data: fullShed } = await owner
    .from("shed_occupancy").select("shed_id, capacity_mt, stored_mt").order("occupancy_pct", { ascending: false }).limit(1);
  const { data: receivedLot } = await owner
    .from("lots").select("id, quantity_mt").eq("status", "received").limit(1);
  const { error: capErr } = await owner
    .from("lots")
    .update({ status: "stored", shed_id: fullShed![0].shed_id })
    .eq("id", receivedLot![0].id);
  check("Storing into the fullest shed is rejected on capacity", !!capErr, capErr?.message?.slice(0, 70));

  // --- Exceptions tell the truth ---
  const { data: lying } = await owner
    .from("exceptions").select("id, type, lots!inner(bl_number, payment_terms)").eq("status", "open");
  const liars = (lying ?? []).filter((e: never) => {
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
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/verify-lot-rules.ts`
Expected: every line PASS.

> If "Storing into the fullest shed is rejected" fails because that shed happens to have room for the chosen lot, pick a larger lot or a fuller shed — the check must genuinely exceed free space to be meaningful.

- [ ] **Step 3: Static gates**

Stop the dev server first (it shares `.next` with the build).
Run: `npm test` → all PASS (28).
Run: `npx tsc --noEmit` → exit 0.
Run: `npm run lint` → exit 0.
Run: `npm run build` → succeeds.

- [ ] **Step 4: Full lifecycle in the browser (the phase's headline verify)**

Restart `npm run dev`. As Owner, create a new import lot (it starts Pending), then walk it:

1. Pending → **Mark as In Transit** → rejected until a B/L is recorded. Add the B/L via Edit, retry → succeeds.
2. In Transit → **Mark as Received**.
3. Received → **Mark as Stored…** → shed picker lists sheds with live free space → choose one → stored.
4. Confirm shed capacity moved:
   ```bash
   npx tsx scripts/db.ts "select name, stored_mt, occupancy_pct from shed_occupancy order by occupancy_pct desc limit 3"
   ```
   Expected: the chosen shed's `stored_mt` rose by the lot's quantity.
5. Stored → **Mark as Dispatched** → then **Delivered**.
6. Confirm the Phase 3 invariant still holds:
   ```bash
   npx tsx scripts/db.ts "select (select count(*)::int from lot_movements where removed_at is null) as open_stays, (select count(*)::int from lots where status='stored') as stored_lots"
   ```
   Expected: equal — the stay opened on store and closed on dispatch.
7. Confirm the audit trail:
   ```bash
   npx tsx scripts/db.ts "select seq, action, entity_type, details->>'from' as from_status, details->>'to' as to_status from audit_log where entity_type='lot' order by seq desc limit 6"
   npx tsx scripts/db.ts "select verify_audit_chain() as first_break"
   ```
   Expected: one row per transition; `first_break` NULL.

- [ ] **Step 5: Management sees no money (the other headline verify)**

Switch to Management via the dev switcher, open the same lot.
Expected: the lot renders; **no Invoices section at all**; no "Market value" row in the Commodity card; no amount anywhere on the page. Confirm with a page search for the currency symbol — zero hits.

- [ ] **Step 6: Resolve an exception**

Open a lot with an open `missing_bl`. Two paths, both must work:
- **Explicit:** type a note → Resolve → it moves to the resolved list.
- **Automatic:** on another flagged lot, Edit → fill the B/L → save → the exception auto-resolves.

```bash
npx tsx scripts/db.ts "select action, entity_type, details->>'auto' as auto from audit_log where entity_type='exception' order by seq desc limit 3"
```
Expected: `resolve`/`exception` rows, one with `auto = true`.

- [ ] **Step 7: Commit**

```bash
git add scripts/verify-lot-rules.ts
git commit -m "test(lots): Phase 4 acceptance verification"
```

---

## Phase 4 Done — Verify Checklist (PLAN.md)

- [ ] Lots list: search, direction filter, status tabs, row → detail.
- [ ] New/Edit form: direction toggle swaps field sets, dependent warehouse → shed, auto lot-number, auto bags, Zod (B/L for in-transit imports, terms for exports).
- [ ] Lot Detail: status stepper with **only permitted transitions as actions**.
- [ ] **Open exceptions shown here with resolve actions** (demo gap fix) — and they tell the truth.
- [ ] Every create/edit/transition writes an audit entry; chain verifies.
- [ ] **Full lifecycle Pending → Delivered works.**
- [ ] **Shed capacity updates on store/dispatch**; Phase 3 invariant still holds.
- [ ] **Management sees the lot but no amounts anywhere on the page.**
- [ ] Illegal transitions rejected by the database, not just the UI.
- [ ] `npm test`, `tsc`, `lint`, `build` clean.

## Self-review notes (author)

- **Spec coverage:** trigger → Task 2; seed truth → Task 3; lifecycle logic → Task 1; Zod rules → Task 4; data layer → Task 5; list → Task 6; form → Task 7; detail/stepper/exceptions → Task 8; verification → Task 9. Every spec error-handling item (illegal transition message, capacity message, notFound, controlled inputs, RLS-doesn't-error) has a step.
- **Type consistency:** `LotStatus`/`LOT_STATUSES`/`STATUS_LABELS`/`allowedTransitions` identical across Tasks 1, 7, 8. `LotActionState` identical across all three client components and `actions.ts`. `LotRow`/`LotDetail`/`LotException` field names match between Task 5 and its consumers.
- **Base UI traps:** Dialog uses `render`-free controlled `open`; links use `buttonVariants`, never `Button render={<Link/>}`; no `DropdownMenuLabel` outside a Group.
- **Phase 3 lessons carried:** form inputs controlled (React 19 resets uncontrolled forms); Server Actions gate on `requireCapability` because RLS reports zero-rows-affected rather than an error on UPDATE.
- **Fixed during review:** Task 8 Step 1 originally re-entered the auth gate inside `autoResolveFieldExceptions` to get a user id — convoluted and it would double-check permissions. Changed to pass `userId` in as a parameter from `saveLot`.
- **Fixed during pre-flight scan (security):** `saveLot` originally took `status` from a hidden form field and fed it to Zod. A client could post `status=pending` on an in-transit import and skip the "B/L required" rule entirely — defeating the business rule this phase exists to enforce. The server now reads the current status from the database (`pending` for new lots), and the form has no status field at all. This is the same lesson as the RLS/`requireCapability` one: never let the client supply the value a security decision is made on.
- **Known risk:** the `listLots` search uses PostgREST `.or()` across embedded resources (`commodities.name.ilike`). If that syntax misbehaves against the view, fall back to searching `lot_number` only and filtering joined names in SQL via an RPC — verify in Task 6 Step 4 before assuming it works.
