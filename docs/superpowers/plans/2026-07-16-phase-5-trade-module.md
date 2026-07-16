# Phase 5 — Trade Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Trade module — Imports/Exports pipeline views (a status Kanban over the existing lots), a Clients directory, a Client profile, and Owner-only client CRUD.

**Architecture:** The pipeline views are a new *shape* over the existing `lots_view` (no new lot machinery). Clients get a server-only data layer (`src/lib/clients.ts`) and a CRUD flow that mirrors the Phase 3 warehouse pattern exactly — Zod, controlled Dialog, `requireCapability` gate, RLS enforcement, audit entries, and a block-with-reason delete guard. Invoice amounts on the client profile are financials-gated the same way Lot Detail does it.

**Tech Stack:** Next.js 15 (App Router, Server Actions), React 19, Supabase (Postgres 17) + `@supabase/ssr`, Tailwind v4, shadcn/ui on Base UI, Zod 4, Vitest.

## Global Constraints

- Stack pinned: **Next.js 15 / React 19 / Tailwind v4 / shadcn (Base UI) / Zod 4**. Do not upgrade, no new dependencies.
- **Base UI, not Radix:** triggers take `render` (not `asChild`); Base UI `Button` expects a native `<button>` — for links use `buttonVariants` on a `<Link>`, never `Button render={<Link/>}`; `DialogTitle` and dropdown group labels sit where the component requires.
- **Schema is sacred**: no migrations this phase (none needed). Do not alter the database schema.
- **RLS before UI**: `clients` is already writable only by `is_owner()`; UI gating via `can()`/`usePermissions()` is cosmetic.
- **RLS does not error on UPDATE/DELETE** — it matches zero rows and reports success. Server Actions MUST gate on `requireCapability` or they report a misleading "saved". (Carried lesson.)
- **React 19 auto-resets uncontrolled forms after an action** — Dialog inputs MUST be controlled or the user's values vanish on a validation error. (Carried lesson.)
- **Client CRUD gates on `manage_users`** — the Owner-only capability, mirroring the `is_owner()` RLS on `clients` and the Phase 3 warehouse precedent. (Semantic mirror, not a new capability — same as warehouses.)
- Reads go through `lots_view` (never raw `lots`) so `market_value` stays masked; invoice amounts render only when `can(role, "view_financials")`.
- Client-profile **volume stats (lot count, MT, import/export split) are operational and NOT gated**; only invoice amounts are gated.
- Delete of a client with lots or invoices is **blocked with a reason**, never a raw FK error.
- Design: match existing screens — mono (`font-mono`) uppercase micro-labels for codes/labels, sans for prose, **design tokens only** (no hardcoded colors; the app has a teal palette + dark mode driven by tokens). Wide content (the Kanban strip, tables) scrolls inside its own `overflow-x-auto` container; the page body never scrolls sideways.
- Seeded users: `owner@tradeflow.example` / `management@tradeflow.example`, password `TradeFlow!2026`.
- Ad-hoc SQL: `npx tsx scripts/db.ts "<sql>"` (prints rows only). Live shared DB — read-only unless a task says otherwise; restore any test writes.
- Stop the dev server before `npm run build` (they share `.next`).

## File structure

| File | Responsibility |
|---|---|
| `src/lib/schemas/client.ts` + `.test.ts` | Zod client schema + unit tests |
| `src/lib/lots.ts` | Add `getPipeline(direction)` (modify) |
| `src/lib/clients.ts` | Directory, profile, stats, lots, gated invoices |
| `src/components/pipeline-board.tsx` | Shared Kanban board (server component) |
| `src/app/(app)/imports/page.tsx` | Imports pipeline |
| `src/app/(app)/exports/page.tsx` | Exports pipeline |
| `src/app/(app)/lots/new/page.tsx` | Read `?direction=` (modify) |
| `src/app/(app)/clients/page.tsx` | Directory |
| `src/app/(app)/clients/client-filters.tsx` | URL-driven filter chips + search (client) |
| `src/app/(app)/clients/[id]/page.tsx` | Profile |
| `src/app/(app)/clients/actions.ts` | `saveClient`, `deleteClient` |
| `src/app/(app)/clients/client-dialog.tsx` | Create/edit Dialog (client) |
| `src/app/(app)/clients/[id]/delete-client-button.tsx` | Delete with blocked-reason |
| `scripts/verify-trade.ts` | Acceptance verification |

---

### Task 1: Client Zod schema (TDD)

**Files:**
- Create: `src/lib/schemas/client.ts`, `src/lib/schemas/client.test.ts`

**Interfaces:**
- Produces: `clientSchema` (Zod); `type ClientInput`. Consumed by Task 7.

- [ ] **Step 1: Write the failing test — `src/lib/schemas/client.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { clientSchema } from "./client";

const base = {
  name: "Acme Foods",
  type: "buyer",
  country: "Brazil",
  contact_name: "Ada Lin",
  email: "ada@acme.example",
  phone: "+55 11 5555 0000",
  currency: "USD",
};

describe("clientSchema", () => {
  it("accepts a valid client", () => {
    const r = clientSchema.safeParse(base);
    expect(r.success).toBe(true);
  });

  it("rejects a short name", () => {
    expect(clientSchema.safeParse({ ...base, name: "A" }).success).toBe(false);
  });

  it("rejects an invalid type", () => {
    expect(clientSchema.safeParse({ ...base, type: "vendor" }).success).toBe(false);
  });

  it("accepts each valid type", () => {
    for (const type of ["buyer", "supplier", "both"]) {
      expect(clientSchema.safeParse({ ...base, type }).success).toBe(true);
    }
  });

  it("rejects a malformed email but allows an empty one", () => {
    expect(clientSchema.safeParse({ ...base, email: "not-an-email" }).success).toBe(false);
    expect(clientSchema.safeParse({ ...base, email: "" }).success).toBe(true);
  });

  it("defaults currency to USD when absent", () => {
    const { email, currency, ...noCurrency } = base;
    void email; void currency;
    const r = clientSchema.safeParse(noCurrency);
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.currency).toBe("USD");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./client`.

- [ ] **Step 3: Implement `src/lib/schemas/client.ts`**

```ts
import { z } from "zod";

/** Shared by the client Dialog and the Server Actions — one source of truth. */
export const clientSchema = z.object({
  name: z.string().trim().min(2, "Name must be at least 2 characters").max(120),
  type: z.enum(["buyer", "supplier", "both"]),
  country: z.string().trim().max(80).optional().default(""),
  contact_name: z.string().trim().max(120).optional().default(""),
  // A real email or blank — never a malformed one.
  email: z.string().trim().email("Enter a valid email").or(z.literal("")).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  // The form is a fixed select, so the value is always one of these.
  currency: z.enum(["USD", "EUR", "GBP", "AED"]).optional().default("USD"),
});

export type ClientInput = z.infer<typeof clientSchema>;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npm test`
Expected: PASS — 6 new tests (40 total).

- [ ] **Step 5: Commit**

```bash
git add src/lib/schemas/client.ts src/lib/schemas/client.test.ts
git commit -m "feat(clients): zod schema with unit tests"
```

---

### Task 2: Pipeline data layer

**Files:**
- Modify: `src/lib/lots.ts`

**Interfaces:**
- Consumes: `lots_view`; `LOT_STATUSES`, `LotStatus` from `@/lib/lot-status`.
- Produces:
  - `type PipelineCard = { id, lot_number, commodity, client, quantity_mt, bags }`
  - `type Pipeline = { stats: { total, in_transit, stored, total_mt }, columns: Record<LotStatus, PipelineCard[]> }`
  - `getPipeline(direction: "import" | "export"): Promise<Pipeline>`
  Consumed by Task 4.

- [ ] **Step 1: Change the lot-status import at the top of `src/lib/lots.ts`**

From:
```ts
import type { LotStatus } from "@/lib/lot-status";
```
to:
```ts
import { LOT_STATUSES, type LotStatus } from "@/lib/lot-status";
```

- [ ] **Step 2: Append `getPipeline` to `src/lib/lots.ts`**

```ts
export type PipelineCard = {
  id: string;
  lot_number: string;
  commodity: string;
  client: string;
  quantity_mt: number;
  bags: number;
};

export type Pipeline = {
  stats: { total: number; in_transit: number; stored: number; total_mt: number };
  columns: Record<LotStatus, PipelineCard[]>;
};

/**
 * All lots of one direction, grouped into a column per lifecycle status.
 * Reads lots_view — no financial columns are selected, so this is safe for any
 * operational role.
 */
export async function getPipeline(direction: "import" | "export"): Promise<Pipeline> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lots_view")
    .select("id, lot_number, status, quantity_mt, bags, commodities!inner(name), clients!inner(name)")
    .eq("direction", direction)
    .order("lot_number", { ascending: false });
  if (error) throw new Error(`getPipeline: ${error.message}`);

  type Row = {
    id: string; lot_number: string; status: LotStatus; quantity_mt: unknown; bags: unknown;
    commodities: { name: string }; clients: { name: string };
  };

  const columns = Object.fromEntries(
    LOT_STATUSES.map((s) => [s, [] as PipelineCard[]]),
  ) as Record<LotStatus, PipelineCard[]>;

  let total_mt = 0;
  for (const r of (data ?? []) as unknown as Row[]) {
    const card: PipelineCard = {
      id: r.id,
      lot_number: r.lot_number,
      commodity: r.commodities.name,
      client: r.clients.name,
      quantity_mt: num(r.quantity_mt),
      bags: num(r.bags),
    };
    columns[r.status].push(card);
    total_mt += card.quantity_mt;
  }

  return {
    stats: {
      total: data?.length ?? 0,
      in_transit: columns.in_transit.length,
      stored: columns.stored.length,
      total_mt,
    },
    columns,
  };
}
```

- [ ] **Step 3: Typecheck + cross-check against SQL**

Run: `npx tsc --noEmit` → exit 0.

```bash
npx tsx scripts/db.ts "select direction, status, count(*)::int as n from lots group by direction, status order by direction, status"
```
Record these numbers — Task 4's board columns must match them per direction.

- [ ] **Step 4: Commit**

```bash
git add src/lib/lots.ts
git commit -m "feat(trade): pipeline data layer grouping lots by status"
```

---

### Task 3: Clients data layer

**Files:**
- Create: `src/lib/clients.ts`

**Interfaces:**
- Consumes: `createClient()` from `@/lib/supabase/server`.
- Produces:
  - `type ClientRow = { id, name, type, country, lot_count }`
  - `type Client = { id, name, type, country, contact_name, email, phone, currency }`
  - `type ClientStats = { lots, total_mt, imports, exports }`
  - `type ClientLotRow = { id, lot_number, direction, status, commodity, quantity_mt }`
  - `type ClientInvoiceRow = { id, invoice_no, lot_number, type, status, currency, amount, amount_paid, due_date }`
  - `listClientsDirectory({ q, type }): Promise<{ rows: ClientRow[]; counts: { buyers, suppliers, withLots } }>`
  - `getClient(id): Promise<Client | null>`
  - `getClientStats(id): Promise<ClientStats>`
  - `getClientLots(id): Promise<ClientLotRow[]>`
  - `getClientInvoices(id): Promise<ClientInvoiceRow[]>`
  Consumed by Tasks 5, 6, 7.

- [ ] **Step 1: Create `src/lib/clients.ts`**

```ts
import "server-only";

import { createClient } from "@/lib/supabase/server";

const num = (v: unknown): number => Number(v ?? 0);

export type ClientRow = {
  id: string;
  name: string;
  type: string;
  country: string | null;
  lot_count: number;
};

export type Client = {
  id: string;
  name: string;
  type: string;
  country: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  currency: string;
};

export type ClientStats = { lots: number; total_mt: number; imports: number; exports: number };

export type ClientLotRow = {
  id: string;
  lot_number: string;
  direction: "import" | "export";
  status: string;
  commodity: string;
  quantity_mt: number;
};

export type ClientInvoiceRow = {
  id: string;
  invoice_no: string;
  lot_number: string | null;
  type: "receivable" | "payable";
  status: string;
  currency: string;
  amount: number;
  amount_paid: number;
  due_date: string | null;
};

/**
 * Directory rows with a lot count each. `type` filter: a `both` client matches
 * `buyer` and `supplier` (and `all`). Name search is a single-column ilike,
 * which supabase-js encodes as a normal parameter — no logic-tree escaping
 * needed (unlike the multi-field `.or()` search on the lots list).
 */
export async function listClientsDirectory(opts: { q?: string; type?: string }): Promise<{
  rows: ClientRow[];
  counts: { buyers: number; suppliers: number; withLots: number };
}> {
  const supabase = await createClient();

  let query = supabase.from("clients").select("id, name, type, country").order("name");
  if (opts.type === "buyer") query = query.in("type", ["buyer", "both"]);
  else if (opts.type === "supplier") query = query.in("type", ["supplier", "both"]);
  if (opts.q?.trim()) query = query.ilike("name", `%${opts.q.trim()}%`);

  const { data: clients, error } = await query;
  if (error) throw new Error(`listClientsDirectory: ${error.message}`);

  // Lot counts per client, in one grouped read merged in JS (there are ~80 clients).
  const { data: lots } = await supabase.from("lots").select("client_id");
  const lotCounts = new Map<string, number>();
  for (const l of lots ?? []) lotCounts.set(l.client_id, (lotCounts.get(l.client_id) ?? 0) + 1);

  const rows: ClientRow[] = (clients ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    type: c.type,
    country: c.country,
    lot_count: lotCounts.get(c.id) ?? 0,
  }));

  // Directory-wide counts (independent of the active filter).
  const { data: allClients } = await supabase.from("clients").select("type");
  let buyers = 0;
  let suppliers = 0;
  for (const c of allClients ?? []) {
    if (c.type === "buyer" || c.type === "both") buyers++;
    if (c.type === "supplier" || c.type === "both") suppliers++;
  }

  return { rows, counts: { buyers, suppliers, withLots: lotCounts.size } };
}

export async function getClient(id: string): Promise<Client | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("clients")
    .select("id, name, type, country, contact_name, email, phone, currency")
    .eq("id", id)
    .maybeSingle();
  return data ? { ...data, currency: data.currency ?? "USD" } : null;
}

/** Operational only — never gated. */
export async function getClientStats(id: string): Promise<ClientStats> {
  const supabase = await createClient();
  const { data } = await supabase.from("lots").select("direction, quantity_mt").eq("client_id", id);
  let total_mt = 0;
  let imports = 0;
  let exports = 0;
  for (const l of data ?? []) {
    total_mt += num(l.quantity_mt);
    if (l.direction === "import") imports++;
    else exports++;
  }
  return { lots: data?.length ?? 0, total_mt, imports, exports };
}

export async function getClientLots(id: string): Promise<ClientLotRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lots_view")
    .select("id, lot_number, direction, status, quantity_mt, commodities!inner(name)")
    .eq("client_id", id)
    .order("lot_number", { ascending: false });
  if (error) throw new Error(`getClientLots: ${error.message}`);

  type Row = {
    id: string; lot_number: string; direction: "import" | "export"; status: string;
    quantity_mt: unknown; commodities: { name: string };
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    lot_number: r.lot_number,
    direction: r.direction,
    status: r.status,
    commodity: r.commodities.name,
    quantity_mt: num(r.quantity_mt),
  }));
}

/** RLS returns nothing here for Management — the mask is the database. */
export async function getClientInvoices(id: string): Promise<ClientInvoiceRow[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("invoices")
    .select("id, invoice_no, type, status, currency, amount, amount_paid, due_date, lots(lot_number)")
    .eq("client_id", id)
    .order("invoice_no");

  type Row = {
    id: string; invoice_no: string; type: "receivable" | "payable"; status: string;
    currency: string; amount: unknown; amount_paid: unknown; due_date: string | null;
    lots: { lot_number: string } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    invoice_no: r.invoice_no,
    lot_number: r.lots?.lot_number ?? null,
    type: r.type,
    status: r.status,
    currency: r.currency,
    amount: num(r.amount),
    amount_paid: num(r.amount_paid),
    due_date: r.due_date,
  }));
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit` → exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/clients.ts
git commit -m "feat(clients): server-only data layer for directory and profile"
```

---

### Task 4: Imports & Exports pipeline UI

**Files:**
- Create: `src/components/pipeline-board.tsx`, `src/app/(app)/imports/page.tsx`, `src/app/(app)/exports/page.tsx`
- Modify: `src/app/(app)/lots/new/page.tsx`

**Interfaces:**
- Consumes: `getPipeline` (Task 2); `LOT_STATUSES`, `STATUS_LABELS` (Task 1 phase); `requireCapability`, `can`, `BlockedScreen`, `buttonVariants`.

> **Invoke the `frontend-design` skill** before the JSX. The board is dense; match the existing card/table conventions (mono for codes and quantities). Design tokens only.

- [ ] **Step 1: Create `src/components/pipeline-board.tsx`**

```tsx
import Link from "next/link";

import { LOT_STATUSES, STATUS_LABELS } from "@/lib/lot-status";
import type { Pipeline } from "@/lib/lots";

const mt = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 0 })} MT`;

export function PipelineBoard({ pipeline }: { pipeline: Pipeline }) {
  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex min-w-max gap-3">
        {LOT_STATUSES.map((status) => {
          const cards = pipeline.columns[status];
          return (
            <div key={status} className="flex w-64 shrink-0 flex-col gap-2">
              <div className="flex items-center justify-between px-1">
                <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                  {STATUS_LABELS[status]}
                </span>
                <span className="font-mono text-xs text-muted-foreground">{cards.length}</span>
              </div>

              <div className="flex flex-col gap-2 rounded-xl border bg-muted/20 p-2">
                {cards.length === 0 ? (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground">Empty</p>
                ) : (
                  cards.map((c) => (
                    <Link
                      key={c.id}
                      href={`/lots/${c.id}`}
                      className="flex flex-col gap-1 rounded-lg border bg-background p-3 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      <span className="font-mono text-xs">{c.lot_number}</span>
                      <span className="text-sm font-medium">{c.commodity}</span>
                      <span className="truncate text-xs text-muted-foreground">{c.client}</span>
                      <span className="font-mono text-[0.6875rem] text-muted-foreground">
                        {mt(c.quantity_mt)} · {c.bags.toLocaleString("en-US")} bags
                      </span>
                    </Link>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/app/(app)/imports/page.tsx`**

```tsx
import Link from "next/link";
import { Plus } from "lucide-react";

import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { can } from "@/lib/permissions";
import { getPipeline } from "@/lib/lots";
import { buttonVariants } from "@/components/ui/button";
import { PipelineBoard } from "@/components/pipeline-board";

const mt = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 0 })} MT`;

export default async function ImportsPage() {
  const gate = await requireCapability("view_operations");
  if (!gate.allowed) return <BlockedScreen required="view_operations" role={gate.role} />;

  const pipeline = await getPipeline("import");
  const stats = [
    { label: "Import lots", value: pipeline.stats.total.toLocaleString("en-US") },
    { label: "In transit", value: pipeline.stats.in_transit.toLocaleString("en-US") },
    { label: "Stored", value: pipeline.stats.stored.toLocaleString("en-US") },
    { label: "Total quantity", value: mt(pipeline.stats.total_mt) },
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Imports</h1>
          <p className="text-sm text-muted-foreground">Inbound pipeline, grouped by lifecycle status.</p>
        </div>
        {can(gate.session.profile.role, "manage_lots") ? (
          <Link href="/lots/new?direction=import" className={buttonVariants({ size: "sm", className: "gap-1.5" })}>
            <Plus className="size-4" />
            New import lot
          </Link>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-xl border p-5 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col gap-1">
            <dt className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">{s.label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>

      {pipeline.stats.total === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm font-medium">No import lots yet</p>
          <p className="mt-1 text-sm text-muted-foreground">New import lots will appear here across the pipeline.</p>
        </div>
      ) : (
        <PipelineBoard pipeline={pipeline} />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `src/app/(app)/exports/page.tsx`**

Same as imports, with these substitutions: `getPipeline("export")`; heading "Exports"; description "Outbound pipeline, grouped by lifecycle status."; stat label "Export lots"; button `href="/lots/new?direction=export"` labelled "New export lot"; empty-state "No export lots yet" / "New export lots will appear here across the pipeline."

```tsx
import Link from "next/link";
import { Plus } from "lucide-react";

import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { can } from "@/lib/permissions";
import { getPipeline } from "@/lib/lots";
import { buttonVariants } from "@/components/ui/button";
import { PipelineBoard } from "@/components/pipeline-board";

const mt = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 0 })} MT`;

export default async function ExportsPage() {
  const gate = await requireCapability("view_operations");
  if (!gate.allowed) return <BlockedScreen required="view_operations" role={gate.role} />;

  const pipeline = await getPipeline("export");
  const stats = [
    { label: "Export lots", value: pipeline.stats.total.toLocaleString("en-US") },
    { label: "In transit", value: pipeline.stats.in_transit.toLocaleString("en-US") },
    { label: "Stored", value: pipeline.stats.stored.toLocaleString("en-US") },
    { label: "Total quantity", value: mt(pipeline.stats.total_mt) },
  ];

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Exports</h1>
          <p className="text-sm text-muted-foreground">Outbound pipeline, grouped by lifecycle status.</p>
        </div>
        {can(gate.session.profile.role, "manage_lots") ? (
          <Link href="/lots/new?direction=export" className={buttonVariants({ size: "sm", className: "gap-1.5" })}>
            <Plus className="size-4" />
            New export lot
          </Link>
        ) : null}
      </div>

      <dl className="grid grid-cols-2 gap-4 rounded-xl border p-5 sm:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="flex flex-col gap-1">
            <dt className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">{s.label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{s.value}</dd>
          </div>
        ))}
      </dl>

      {pipeline.stats.total === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm font-medium">No export lots yet</p>
          <p className="mt-1 text-sm text-muted-foreground">New export lots will appear here across the pipeline.</p>
        </div>
      ) : (
        <PipelineBoard pipeline={pipeline} />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Modify `src/app/(app)/lots/new/page.tsx` to honour `?direction=`**

Change the signature to accept `searchParams`, derive the initial direction, and pass it. Replace the component with:

```tsx
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { listCommodities, listClients } from "@/lib/lots";
import { LotForm } from "../lot-form";

export default async function NewLotPage({
  searchParams,
}: {
  searchParams: Promise<{ direction?: string }>;
}) {
  const gate = await requireCapability("manage_lots");
  if (!gate.allowed) return <BlockedScreen required="manage_lots" role={gate.role} />;

  const { direction } = await searchParams;
  const initialDirection = direction === "export" ? "export" : "import";

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
          direction: initialDirection, status: "pending", commodity_id: "", client_id: "",
          quantity_mt: "", origin_country: "", destination_country: "", vessel_name: "",
          bl_number: "", export_ref: "", payment_terms: "", eta: "", notes: "",
        }}
      />
    </div>
  );
}
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` → exit 0.

Run `npm run dev`, sign in as Owner. Open `/imports`: the four stat tiles and six columns render; each column's card count matches the import numbers from Task 2 Step 3. Open `/exports`: likewise for exports. Click "New import lot" → the form opens with the direction toggle on **Import**; "New export lot" → on **Export**.

Cross-check one column count against SQL:
```bash
npx tsx scripts/db.ts "select status, count(*)::int as n from lots where direction='import' group by status order by 1"
```
Expected: matches the Imports board columns exactly.

On a narrow window the column strip scrolls horizontally inside its own container; the page itself does not scroll sideways.

- [ ] **Step 6: Commit**

```bash
git add src/components/pipeline-board.tsx "src/app/(app)/imports/page.tsx" "src/app/(app)/exports/page.tsx" "src/app/(app)/lots/new/page.tsx"
git commit -m "feat(trade): imports/exports pipeline boards and direction-preset new-lot link"
```

---

### Task 5: Clients directory

**Files:**
- Create: `src/app/(app)/clients/client-filters.tsx`
- Modify: `src/app/(app)/clients/page.tsx`

**Interfaces:**
- Consumes: `listClientsDirectory` (Task 3); `requireCapability`, `BlockedScreen`.

> **Invoke the `frontend-design` skill** before the JSX. Match the lots-list table conventions. (CRUD controls come in Task 7 — this task is the read-only directory.)

- [ ] **Step 1: Create `src/app/(app)/clients/client-filters.tsx`**

```tsx
"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** URL-driven so a filtered directory is shareable and survives reload. */
export function ClientFilters({
  counts,
}: {
  counts: { buyers: number; suppliers: number; withLots: number };
}) {
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
    startTransition(() => router.push(`${pathname}?${next.toString()}`));
  };

  const type = params.get("type") ?? "";

  const chips = [
    { value: "", label: "All" },
    { value: "buyer", label: `Buyers · ${counts.buyers}` },
    { value: "supplier", label: `Suppliers · ${counts.suppliers}` },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        className="relative min-w-56 flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          set({ q });
        }}
      >
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search clients by name…"
          className="pl-9"
          aria-label="Search clients"
        />
      </form>

      <div className="flex items-center gap-1 rounded-lg border p-0.5">
        {chips.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => set({ type: c.value || null })}
            className={cn(
              "rounded-md px-3 py-1 text-sm transition-colors",
              type === c.value
                ? "bg-accent font-medium text-accent-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {c.label}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `src/app/(app)/clients/page.tsx`**

```tsx
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { listClientsDirectory } from "@/lib/clients";
import { ClientFilters } from "./client-filters";

const TYPE_LABELS: Record<string, string> = { buyer: "Buyer", supplier: "Supplier", both: "Buyer & Supplier" };

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const gate = await requireCapability("view_operations");
  if (!gate.allowed) return <BlockedScreen required="view_operations" role={gate.role} />;

  const sp = await searchParams;
  const { rows, counts } = await listClientsDirectory({ q: sp.q, type: sp.type });

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
        <p className="text-sm text-muted-foreground">
          {counts.buyers} buyers · {counts.suppliers} suppliers · {counts.withLots} with active lots.
        </p>
      </div>

      <ClientFilters counts={counts} />

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm font-medium">No clients match</p>
          <p className="mt-1 text-sm text-muted-foreground">Try clearing the search or type filter.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/40">
              <tr className="text-left font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium">Country</th>
                <th className="px-4 py-2.5 text-right font-medium">Lots</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="group border-b last:border-0 hover:bg-muted/30">
                  <td className="px-4 py-2.5">
                    <Link href={`/clients/${c.id}`} className="font-medium underline-offset-4 hover:underline">
                      {c.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">{TYPE_LABELS[c.type] ?? c.type}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{c.country ?? "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c.lot_count.toLocaleString("en-US")}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Link href={`/clients/${c.id}`} aria-label={`Open ${c.name}`}>
                      <ArrowRight className="ml-auto size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                    </Link>
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

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit` → exit 0.

As Owner, open `/clients`: 80 rows; header reads "50 buyers · 30 suppliers · N with active lots". Click Buyers → `?type=buyer`, rows narrow to buyers + `both`; count in SQL:
```bash
npx tsx scripts/db.ts "select count(*)::int as buyers_or_both from clients where type in ('buyer','both')"
```
Expected: matches the filtered row count. Search a client name → `?q=…` narrows correctly and survives reload.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/clients/page.tsx" "src/app/(app)/clients/client-filters.tsx"
git commit -m "feat(clients): directory with type filter and name search"
```

---

### Task 6: Client profile

**Files:**
- Modify: `src/app/(app)/clients/[id]/page.tsx`

**Interfaces:**
- Consumes: `getClient`, `getClientStats`, `getClientLots`, `getClientInvoices` (Task 3); `can`, `STATUS_LABELS`.

> **Invoke the `frontend-design` skill** before the JSX. (Edit/delete controls come in Task 7.)

- [ ] **Step 1: Rewrite `src/app/(app)/clients/[id]/page.tsx`**

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";

import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { can } from "@/lib/permissions";
import { getClient, getClientStats, getClientLots, getClientInvoices } from "@/lib/clients";
import { STATUS_LABELS, type LotStatus } from "@/lib/lot-status";

const mt = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 0 })} MT`;
const money = (n: number, ccy: string) =>
  `${ccy} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const TYPE_LABELS: Record<string, string> = { buyer: "Buyer", supplier: "Supplier", both: "Buyer & Supplier" };

export default async function ClientProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const gate = await requireCapability("view_operations");
  if (!gate.allowed) return <BlockedScreen required="view_operations" role={gate.role} />;

  const { id } = await params;
  const client = await getClient(id);
  if (!client) notFound();

  const showMoney = can(gate.session.profile.role, "view_financials");

  const [stats, lots, invoices] = await Promise.all([
    getClientStats(id),
    getClientLots(id),
    // Not merely hidden: RLS returns nothing for Management anyway.
    showMoney ? getClientInvoices(id) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Link href="/clients" className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ChevronLeft className="size-4" />
        Clients
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
          <p className="text-sm text-muted-foreground">
            {TYPE_LABELS[client.type] ?? client.type}
            {client.country ? ` · ${client.country}` : ""}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-xl border p-5">
          <h2 className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">Contact</h2>
          <dl className="flex flex-col gap-2">
            {[
              { label: "Contact", value: client.contact_name },
              { label: "Email", value: client.email },
              { label: "Phone", value: client.phone },
              { label: "Currency", value: client.currency },
            ].map((r) => (
              <div key={r.label} className="flex items-baseline justify-between gap-3">
                <dt className="text-sm text-muted-foreground">{r.label}</dt>
                <dd className="text-sm">{r.value || "—"}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border p-5">
          <h2 className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">Volume</h2>
          <dl className="grid grid-cols-2 gap-4">
            {[
              { label: "Total lots", value: stats.lots.toLocaleString("en-US") },
              { label: "Total quantity", value: mt(stats.total_mt) },
              { label: "Imports", value: stats.imports.toLocaleString("en-US") },
              { label: "Exports", value: stats.exports.toLocaleString("en-US") },
            ].map((s) => (
              <div key={s.label} className="flex flex-col gap-1">
                <dt className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">{s.label}</dt>
                <dd className="text-lg font-semibold tabular-nums">{s.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Lots</h2>
        {lots.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No lots for this client yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr className="text-left font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Lot</th>
                  <th className="px-4 py-2.5 font-medium">Dir</th>
                  <th className="px-4 py-2.5 font-medium">Commodity</th>
                  <th className="px-4 py-2.5 text-right font-medium">Quantity</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {lots.map((l) => (
                  <tr key={l.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <Link href={`/lots/${l.id}`} className="font-mono text-xs underline-offset-4 hover:underline">
                        {l.lot_number}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                      {l.direction === "import" ? "IMP" : "EXP"}
                    </td>
                    <td className="px-4 py-2.5">{l.commodity}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{mt(l.quantity_mt)}</td>
                    <td className="px-4 py-2.5">
                      <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium">
                        {STATUS_LABELS[l.status as LotStatus]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showMoney ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium">Invoices</h2>
          {invoices.length === 0 ? (
            <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              No invoices for this client.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/40">
                  <tr className="text-left font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                    <th className="px-4 py-2.5 font-medium">Invoice</th>
                    <th className="px-4 py-2.5 font-medium">Lot</th>
                    <th className="px-4 py-2.5 font-medium">Type</th>
                    <th className="px-4 py-2.5 font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                    <th className="px-4 py-2.5 text-right font-medium">Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((i) => (
                    <tr key={i.id} className="border-b last:border-0">
                      <td className="px-4 py-2.5 font-mono text-xs">{i.invoice_no}</td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{i.lot_number ?? "—"}</td>
                      <td className="px-4 py-2.5">{i.type === "receivable" ? "AR" : "AP"}</td>
                      <td className="px-4 py-2.5 capitalize text-muted-foreground">{i.status}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{money(i.amount, i.currency)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                        {money(i.amount_paid, i.currency)}
                      </td>
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
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` → exit 0.

As Owner, open a client from the directory. Confirm the contact card, the four volume stats, the lots table, and the invoices table (with amounts + lot links). Cross-check the volume against SQL for that client id:
```bash
npx tsx scripts/db.ts "select count(*)::int as lots, sum(quantity_mt)::int as mt, count(*) filter (where direction='import')::int as imports, count(*) filter (where direction='export')::int as exports from lots where client_id='<ID>'"
```
Expected: matches the Volume card. A bad id (`/clients/00000000-0000-0000-0000-000000000000`) → 404.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/clients/[id]/page.tsx"
git commit -m "feat(clients): profile with volume, lots, and gated invoices"
```

---

### Task 7: Client CRUD (Owner-only)

**Files:**
- Create: `src/app/(app)/clients/actions.ts`, `src/app/(app)/clients/client-dialog.tsx`, `src/app/(app)/clients/[id]/delete-client-button.tsx`
- Modify: `src/app/(app)/clients/page.tsx`, `src/app/(app)/clients/[id]/page.tsx`

**Interfaces:**
- Consumes: `clientSchema` (Task 1); `writeAudit`; `requireCapability`; `can`.
- Produces: `type ClientActionState = { error: string | null; fieldErrors?: Record<string,string>; ok?: boolean }`; `saveClient(prev, formData)`, `deleteClient(prev, formData)`.

> **Invoke the `frontend-design` skill** before the Dialog JSX. Mirror `src/app/(app)/warehouses/warehouse-dialog.tsx` and `warehouses/actions.ts` exactly.

- [ ] **Step 1: Create `src/app/(app)/clients/actions.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { requireCapability } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { clientSchema } from "@/lib/schemas/client";

export type ClientActionState = {
  error: string | null;
  fieldErrors?: Record<string, string>;
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

const nz = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
const f = (formData: FormData, key: string) => formData.get(key) ?? undefined;

export async function saveClient(_prev: ClientActionState, formData: FormData): Promise<ClientActionState> {
  const gate = await requireCapability("manage_users");
  if (!gate.allowed) return { error: "Owner access required." };

  const parsed = clientSchema.safeParse({
    name: f(formData, "name"),
    type: f(formData, "type"),
    country: f(formData, "country"),
    contact_name: f(formData, "contact_name"),
    email: f(formData, "email"),
    phone: f(formData, "phone"),
    currency: f(formData, "currency"),
  });
  if (!parsed.success) return { error: null, fieldErrors: zodFieldErrors(parsed.error.issues) };

  const v = parsed.data;
  const row = {
    name: v.name,
    type: v.type,
    country: nz(v.country),
    contact_name: nz(v.contact_name),
    email: nz(v.email),
    phone: nz(v.phone),
    currency: v.currency,
  };

  const id = String(formData.get("id") ?? "");
  const supabase = await createClient();

  if (id) {
    const { data: before } = await supabase
      .from("clients")
      .select("name, type, country, contact_name, email, phone, currency")
      .eq("id", id)
      .maybeSingle();
    const { error } = await supabase.from("clients").update(row).eq("id", id);
    if (error) return { error: error.message };
    await writeAudit("update", "client", id, { before, after: row });
  } else {
    const { data, error } = await supabase.from("clients").insert(row).select("id").single();
    if (error) return { error: error.message };
    await writeAudit("create", "client", data.id, { after: row });
  }

  revalidatePath("/clients");
  if (id) revalidatePath(`/clients/${id}`);
  return { error: null, ok: true };
}

/** Blocks deletion of a client that has lots or invoices, with a reason. */
export async function deleteClient(_prev: ClientActionState, formData: FormData): Promise<ClientActionState> {
  const gate = await requireCapability("manage_users");
  if (!gate.allowed) return { error: "Owner access required." };

  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing client." };

  const supabase = await createClient();
  const { data: client } = await supabase.from("clients").select("name").eq("id", id).maybeSingle();

  const { count: lotCount } = await supabase
    .from("lots")
    .select("*", { count: "exact", head: true })
    .eq("client_id", id);
  const { count: invCount } = await supabase
    .from("invoices")
    .select("*", { count: "exact", head: true })
    .eq("client_id", id);

  if ((lotCount ?? 0) > 0 || (invCount ?? 0) > 0) {
    const parts: string[] = [];
    if ((lotCount ?? 0) > 0) parts.push(`${lotCount} lot${lotCount === 1 ? "" : "s"}`);
    if ((invCount ?? 0) > 0) parts.push(`${invCount} invoice${invCount === 1 ? "" : "s"}`);
    return {
      error: `${client?.name ?? "This client"} has ${parts.join(" and ")}. Reassign or remove those first.`,
    };
  }

  const { error } = await supabase.from("clients").delete().eq("id", id);
  if (error) return { error: error.message };

  await writeAudit("delete", "client", id, { before: { name: client?.name } });

  revalidatePath("/clients");
  return { error: null, ok: true };
}
```

- [ ] **Step 2: Create `src/app/(app)/clients/client-dialog.tsx`**

```tsx
"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { saveClient, type ClientActionState } from "./actions";

const labelClass = "font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground";
const selectClass =
  "h-9 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50";

type Client = {
  id: string;
  name: string;
  type: string;
  country: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  currency: string;
};

function SubmitButton({ isEdit }: { isEdit: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : isEdit ? "Save changes" : "Create client"}
    </Button>
  );
}

export function ClientDialog({ client }: { client?: Client }) {
  const isEdit = Boolean(client);
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState<ClientActionState, FormData>(saveClient, { error: null });

  // Controlled inputs: React 19 resets an uncontrolled form after the action
  // completes, wiping the user's values on a validation error.
  const [name, setName] = useState(client?.name ?? "");
  const [type, setType] = useState(client?.type ?? "buyer");
  const [country, setCountry] = useState(client?.country ?? "");
  const [contact, setContact] = useState(client?.contact_name ?? "");
  const [email, setEmail] = useState(client?.email ?? "");
  const [phone, setPhone] = useState(client?.phone ?? "");
  const [currency, setCurrency] = useState(client?.currency ?? "USD");

  // Close only on a successful save; errors keep the Dialog open with values.
  useEffect(() => {
    if (state.ok) setOpen(false);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button variant={isEdit ? "outline" : "default"} size="sm" className="gap-1.5">
            {isEdit ? "Edit" : (<><Plus className="size-4" />New client</>)}
          </Button>
        }
      />
      <DialogContent className="sm:max-w-md">
        <DialogTitle>{isEdit ? "Edit client" : "New client"}</DialogTitle>
        <DialogDescription>A buyer, supplier, or both — used across lots and invoices.</DialogDescription>

        <form action={formAction} className="mt-2 flex flex-col gap-4">
          {client ? <input type="hidden" name="id" value={client.id} /> : null}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="c-name" className={labelClass}>Name</Label>
            <Input id="c-name" name="name" value={name} onChange={(e) => setName(e.target.value)} required />
            {state.fieldErrors?.name ? <p className="text-xs text-destructive">{state.fieldErrors.name}</p> : null}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-type" className={labelClass}>Type</Label>
              <select id="c-type" name="type" value={type} onChange={(e) => setType(e.target.value)} className={selectClass}>
                <option value="buyer">Buyer</option>
                <option value="supplier">Supplier</option>
                <option value="both">Both</option>
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-currency" className={labelClass}>Currency</Label>
              <select id="c-currency" name="currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className={selectClass}>
                {["USD", "EUR", "GBP", "AED"].map((x) => (
                  <option key={x} value={x}>{x}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="c-country" className={labelClass}>Country</Label>
            <Input id="c-country" name="country" value={country} onChange={(e) => setCountry(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="c-contact" className={labelClass}>Contact name</Label>
            <Input id="c-contact" name="contact_name" value={contact} onChange={(e) => setContact(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-email" className={labelClass}>Email</Label>
              <Input id="c-email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              {state.fieldErrors?.email ? <p className="text-xs text-destructive">{state.fieldErrors.email}</p> : null}
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="c-phone" className={labelClass}>Phone</Label>
              <Input id="c-phone" name="phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>

          {state.error ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>
          ) : null}

          <div className="mt-2 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <SubmitButton isEdit={isEdit} />
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Create `src/app/(app)/clients/[id]/delete-client-button.tsx`**

```tsx
"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { deleteClient, type ClientActionState } from "../actions";

/** Deletion is refused (with a reason) when the client has lots or invoices. */
export function DeleteClientButton({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [state, formAction] = useActionState<ClientActionState, FormData>(deleteClient, { error: null });

  // On a clean delete the client no longer exists — return to the directory.
  useEffect(() => {
    if (state.ok) router.push("/clients");
  }, [state, router]);

  return (
    <div className="flex flex-col items-end gap-1">
      <form action={formAction}>
        <input type="hidden" name="id" value={clientId} />
        <Button type="submit" variant="outline" size="sm" className="gap-1.5">
          <Trash2 className="size-4" />
          Delete
        </Button>
      </form>
      {state.error ? (
        <p role="alert" className="max-w-xs text-right text-xs text-destructive">{state.error}</p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 4: Wire the "New client" button into the directory**

In `src/app/(app)/clients/page.tsx`, add imports:
```tsx
import { can } from "@/lib/permissions";
import { ClientDialog } from "./client-dialog";
```
Replace the heading block with:
```tsx
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="text-sm text-muted-foreground">
            {counts.buyers} buyers · {counts.suppliers} suppliers · {counts.withLots} with active lots.
          </p>
        </div>
        {can(gate.session.profile.role, "manage_users") ? <ClientDialog /> : null}
      </div>
```

- [ ] **Step 5: Wire Edit + Delete into the profile**

In `src/app/(app)/clients/[id]/page.tsx`, add imports:
```tsx
import { ClientDialog } from "../client-dialog";
import { DeleteClientButton } from "./delete-client-button";
```
Add `const isOwner = can(gate.session.profile.role, "manage_users");` after `showMoney`, and replace the header block with:
```tsx
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{client.name}</h1>
          <p className="text-sm text-muted-foreground">
            {TYPE_LABELS[client.type] ?? client.type}
            {client.country ? ` · ${client.country}` : ""}
          </p>
        </div>
        {isOwner ? (
          <div className="flex items-center gap-2">
            <ClientDialog
              client={{
                id: client.id, name: client.name, type: client.type, country: client.country,
                contact_name: client.contact_name, email: client.email, phone: client.phone,
                currency: client.currency,
              }}
            />
            <DeleteClientButton clientId={client.id} />
          </div>
        ) : null}
      </div>
```

- [ ] **Step 6: Verify CRUD, RBAC, audit, delete guard**

Run: `npx tsc --noEmit` → exit 0; `npm run lint` → exit 0.

As **Owner**:
- "New client" → Dialog opens; **×** closes it; submit name `A` → inline "Name must be at least 2 characters", Dialog stays open with values.
- Create "Test Trader" (buyer, USD) → appears in the directory.
- Edit it → change country → saved.
- Delete "Test Trader" (no lots) → removed, back to directory.
- Open a seeded client with lots → Delete → refused inline: *"<name> has N lots and M invoices. Reassign or remove those first."*

Confirm audit + chain:
```bash
npx tsx scripts/db.ts "select seq, action, entity_type from audit_log where entity_type='client' order by seq desc limit 4"
npx tsx scripts/db.ts "select verify_audit_chain() as first_break"
```
Expected: create/update/delete `client` rows; `first_break` NULL.

As **Management** (dev switcher): `/clients` and a profile render, but **no** New client / Edit / Delete controls.

- [ ] **Step 7: Clean up the test row**

```bash
npx tsx scripts/db.ts "delete from clients where name='Test Trader'"
```

- [ ] **Step 8: Commit**

```bash
git add "src/app/(app)/clients"
git commit -m "feat(clients): owner-only CRUD with zod, audit entries, delete guard"
```

---

### Task 8: Acceptance verification

**Files:**
- Create: `scripts/verify-trade.ts`

- [ ] **Step 1: Create `scripts/verify-trade.ts`**

```ts
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
  const { data: someClient } = await owner
    .from("invoices").select("client_id").limit(1);
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
```

- [ ] **Step 2: Run it**

Run: `npx tsx scripts/verify-trade.ts`
Expected: every line PASS.

> Note: `Management update … affects 0 rows` is the correct RLS behaviour — UPDATE does not error, it matches zero rows (INSERT does error via WITH CHECK). This is why the Server Actions also gate on `requireCapability`.

- [ ] **Step 3: Static gates**

Stop the dev server first.
Run: `npm test` → all PASS (40). `npx tsc --noEmit` → 0. `npm run lint` → 0. `npm run build` → succeeds.

- [ ] **Step 4: Browser pass**

Restart `npm run dev`. As Owner: `/imports` and `/exports` boards; `/clients` directory → a profile → its lots and invoices; the "New … lot" buttons pre-set direction. As Management (dev switcher): the same three screens render with volume but no invoice money and no client CRUD controls. Check a narrow width: the Kanban strip scrolls inside its container, the page doesn't scroll sideways.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-trade.ts
git commit -m "test(trade): Phase 5 acceptance verification"
```

---

## Phase 5 Done — Verify Checklist (PLAN.md)

- [ ] Imports view + Exports view: summary stats, status-bucket grouping (Kanban), cards, "New Import/Export Lot" pre-setting direction.
- [ ] Clients directory: filter buyers/suppliers, stats.
- [ ] Client profile: contact, volume, lots list, invoices list (gated) + client CRUD.
- [ ] **Counts match the lots table** (pipeline columns == SQL group by status per direction).
- [ ] **Management sees client profiles without invoice amounts** (verified via a real session).
- [ ] Owner client CRUD works, audit-logged; delete blocked with a reason.
- [ ] `npm test`, `tsc`, `lint`, `build` clean.

## Self-review notes (author)

- **Spec coverage:** schema → Task 1; pipeline data → Task 2; clients data → Task 3; pipeline UI + `?direction=` → Task 4; directory → Task 5; profile → Task 6; CRUD + delete guard + audit → Task 7; verification → Task 8. Every spec error-handling item (404, inline Zod errors, delete reason, RLS refusal, empty pipeline) has a step.
- **Type consistency:** `Pipeline`/`PipelineCard` match between Task 2 and Task 4; `ClientRow`/`Client`/`ClientStats`/`ClientLotRow`/`ClientInvoiceRow` match between Task 3 and Tasks 5/6; `ClientActionState` identical across Task 7's action and both client components; `clientSchema` fields match the Dialog's field names.
- **Carried lessons baked in:** controlled Dialog inputs; Server Actions gate on `requireCapability` because RLS reports zero-rows on UPDATE; `getPipeline`/client reads go through `lots_view` so no money leaks; directory search is a single-column `.ilike` (no logic-tree escaping needed, unlike the lots `.or()` search).
- **No migration:** clients are already Owner-write and no-cascade, so the whole phase is app-layer.
- **Known scope note:** client CRUD gates on `manage_users` (the Owner-only capability), mirroring Phase 3's warehouse gating. If a dedicated Finance/Sales role should ever manage the directory, that needs its own capability + RLS change — out of scope for v1, flagged so it isn't read as an oversight.
