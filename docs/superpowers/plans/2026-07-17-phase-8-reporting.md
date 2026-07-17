# Phase 8 — Reporting: Balance Sheet / P&L Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/reports` screen (gated `view_financials`) with a due-date range selector, an executive P&L summary, AR/AP flow, a per-commodity performance table, currency exposure, and a ledger feed — all aggregation done in SQL.

**Architecture:** Two `SECURITY INVOKER` SQL functions take date bounds and return aggregated P&L rows (invoice RLS protects them). Pure date/margin helpers are unit-tested. A server-only data layer wraps the rpcs and reuses Phase 6's `getAccountsSummary` for currency exposure. The page is a server component with a URL-driven range.

**Tech Stack:** Next.js 15 App Router, Supabase (Postgres 17, RLS, rpc), Vitest, Tailwind v4.

## Global Constraints

- **Next.js 15**, not 16.
- **Schema is sacred**: all DDL in one reviewed migration (`0015_reporting.sql`).
- **Aggregation in SQL** (PLAN §8): sums/group-bys live in the SQL functions; only the margin ratio is computed in the app.
- **Reporting basis = invoice `due_date`.** Null-due invoices appear only under All Time (open bounds). Bounded ranges are trailing and end today.
- **Recognition:** revenue = Σ receivable `amount`; cost = Σ payable `amount`; collected = Σ `amount_paid` (receivable); liquidation % = collected ÷ revenue; margin % = profit ÷ revenue (both guarded).
- **Financial gating:** `/reports` gated `view_financials`; SQL functions `SECURITY INVOKER` so invoice RLS returns nothing to Management even via a direct rpc.
- **USD executive summary** (seed all-USD); currency exposure is the per-currency view from `getAccountsSummary`.
- **Shared live database**: the acceptance script is read-only (no writes); never truncate/reseed.

---

## File Structure

**Create:**
- `supabase/migrations/0015_reporting.sql` — `report_pnl_summary`, `report_by_commodity`.
- `supabase/tests/verify_phase8.sql` — function-existence checks.
- `src/lib/report-range.ts` + `src/lib/report-range.test.ts` — pure range/margin helpers.
- `src/lib/reports.ts` — server-only data layer.
- `scripts/verify-reports.ts` — acceptance script.

**Modify:**
- `src/app/(app)/reports/page.tsx` — replace the placeholder.

---

## Task 1: Reporting SQL functions

**Files:**
- Create: `supabase/migrations/0015_reporting.sql`
- Create: `supabase/tests/verify_phase8.sql`

**Interfaces:**
- Produces: `report_pnl_summary(p_from date, p_to date)` → `(revenue, cost, gross_profit, ar_collected, ar_outstanding, ap_outstanding)`; `report_by_commodity(p_from date, p_to date)` → `(commodity, revenue, cost, profit)`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/0015_reporting.sql`:

```sql
-- Phase 8: reporting aggregation. SECURITY INVOKER so invoice RLS applies.
-- Reporting basis is due_date; null bounds mean "open" (All Time).

create or replace function public.report_pnl_summary(p_from date, p_to date)
returns table (
  revenue numeric, cost numeric, gross_profit numeric,
  ar_collected numeric, ar_outstanding numeric, ap_outstanding numeric
) language sql stable security invoker set search_path = public as $$
  with scoped as (
    select type, amount, amount_paid from public.invoices
     where (p_from is null or (due_date is not null and due_date >= p_from))
       and (p_to   is null or (due_date is not null and due_date <= p_to))
  )
  select
    coalesce(sum(amount) filter (where type = 'receivable'), 0),
    coalesce(sum(amount) filter (where type = 'payable'), 0),
    coalesce(sum(amount) filter (where type = 'receivable'), 0)
      - coalesce(sum(amount) filter (where type = 'payable'), 0),
    coalesce(sum(amount_paid) filter (where type = 'receivable'), 0),
    coalesce(sum(amount - amount_paid) filter (where type = 'receivable'), 0),
    coalesce(sum(amount - amount_paid) filter (where type = 'payable'), 0)
  from scoped;
$$;

create or replace function public.report_by_commodity(p_from date, p_to date)
returns table (commodity text, revenue numeric, cost numeric, profit numeric)
language sql stable security invoker set search_path = public as $$
  with scoped as (
    select i.type, i.amount, c.name as commodity
      from public.invoices i
      left join public.lots l on l.id = i.lot_id
      left join public.commodities c on c.id = l.commodity_id
     where (p_from is null or (i.due_date is not null and i.due_date >= p_from))
       and (p_to   is null or (i.due_date is not null and i.due_date <= p_to))
  )
  select
    coalesce(commodity, 'Unattributed'),
    coalesce(sum(amount) filter (where type = 'receivable'), 0),
    coalesce(sum(amount) filter (where type = 'payable'), 0),
    coalesce(sum(amount) filter (where type = 'receivable'), 0)
      - coalesce(sum(amount) filter (where type = 'payable'), 0)
  from scoped
  group by coalesce(commodity, 'Unattributed')
  order by 4 desc;
$$;

grant execute on function public.report_pnl_summary(date, date),
                        public.report_by_commodity(date, date) to authenticated;
```

- [ ] **Step 2: Write the verification script**

Create `supabase/tests/verify_phase8.sql`:

```sql
select 'report_pnl_summary fn' as check,
  to_regprocedure('public.report_pnl_summary(date,date)') is not null as ok
union all
select 'report_by_commodity fn',
  to_regprocedure('public.report_by_commodity(date,date)') is not null
union all
select 'summary returns a row',
  (select count(*) from public.report_pnl_summary(null, null)) = 1;
```

- [ ] **Step 3: Apply the migration**

`node "$CLAUDE_JOB_DIR/tmp/run-sql.mjs" supabase/migrations/0015_reporting.sql` (or the SQL editor).

- [ ] **Step 4: Verify**

Run `verify_phase8.sql`. Expected: all 3 rows `ok = true`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0015_reporting.sql supabase/tests/verify_phase8.sql
git commit -m "feat(reports): P&L summary and per-commodity SQL aggregation functions"
```

---

## Task 2: Pure range + margin helpers (TDD)

**Files:**
- Create: `src/lib/report-range.ts` + `src/lib/report-range.test.ts`

**Interfaces:**
- Produces: `type ReportRange`, `type Bounds`, `rangeBounds(range, today)`, `marginPct(profit, revenue)`, `RANGE_LABELS`.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/report-range.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { rangeBounds, marginPct } from "./report-range";

const today = new Date("2026-07-17T12:00:00Z");

describe("rangeBounds", () => {
  it("month runs from the first of the month to today", () => {
    expect(rangeBounds("month", today)).toEqual({ from: "2026-07-01", to: "2026-07-17" });
  });
  it("90d runs from 90 days ago to today", () => {
    expect(rangeBounds("90d", today)).toEqual({ from: "2026-04-18", to: "2026-07-17" });
  });
  it("all is open on both ends", () => {
    expect(rangeBounds("all", today)).toEqual({ from: null, to: null });
  });
});

describe("marginPct", () => {
  it("is profit over revenue as a percentage", () => expect(marginPct(250, 1000)).toBe(25));
  it("is zero when revenue is zero (guard)", () => expect(marginPct(-100, 0)).toBe(0));
  it("can be negative", () => expect(marginPct(-200, 1000)).toBe(-20));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/report-range.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/lib/report-range.ts`:

```ts
export type ReportRange = "month" | "90d" | "all";
export type Bounds = { from: string | null; to: string | null };

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** All computation is in UTC so bounds are timezone-independent. */
export function rangeBounds(range: ReportRange, today: Date): Bounds {
  if (range === "all") return { from: null, to: null };
  const to = iso(today);
  if (range === "month") {
    return { from: iso(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), to };
  }
  return { from: iso(new Date(today.getTime() - 90 * 86_400_000)), to };
}

export function marginPct(profit: number, revenue: number): number {
  return revenue > 0 ? (profit / revenue) * 100 : 0;
}

export const RANGE_LABELS: Record<ReportRange, string> = {
  month: "This Month",
  "90d": "90 Days",
  all: "All Time",
};
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/lib/report-range.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/report-range.ts src/lib/report-range.test.ts
git commit -m "feat(reports): pure date-range and margin helpers with unit tests"
```

---

## Task 3: Reports data layer

**Files:**
- Create: `src/lib/reports.ts`

**Interfaces:**
- Consumes: `rangeBounds`, `marginPct`, `type ReportRange`; `createClient` (server).
- Produces: `type PnlSummary`, `type CommodityRow`, `type LedgerRow`; `getPnlSummary(range)`, `getCommodityPerformance(range)`, `getLedgerFeed(range, limit?)`.

- [ ] **Step 1: Write the data layer**

Create `src/lib/reports.ts`:

```ts
import "server-only";

import { createClient } from "@/lib/supabase/server";
import { marginPct, rangeBounds, type ReportRange } from "@/lib/report-range";

const num = (v: unknown): number => Number(v ?? 0);

export type PnlSummary = {
  revenue: number; cost: number; gross_profit: number;
  ar_collected: number; ar_outstanding: number; ap_outstanding: number;
};

export type CommodityRow = {
  commodity: string; revenue: number; cost: number; profit: number; margin: number;
};

export type LedgerRow = {
  id: string; invoice_no: string; type: "receivable" | "payable";
  client: string | null; amount: number; currency: string;
  due_date: string | null; status: string;
};

export async function getPnlSummary(range: ReportRange): Promise<PnlSummary> {
  const { from, to } = rangeBounds(range, new Date());
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_pnl_summary", { p_from: from, p_to: to });
  if (error) throw new Error(`getPnlSummary: ${error.message}`);
  const r = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  return {
    revenue: num(r?.revenue),
    cost: num(r?.cost),
    gross_profit: num(r?.gross_profit),
    ar_collected: num(r?.ar_collected),
    ar_outstanding: num(r?.ar_outstanding),
    ap_outstanding: num(r?.ap_outstanding),
  };
}

export async function getCommodityPerformance(range: ReportRange): Promise<CommodityRow[]> {
  const { from, to } = rangeBounds(range, new Date());
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("report_by_commodity", { p_from: from, p_to: to });
  if (error) throw new Error(`getCommodityPerformance: ${error.message}`);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const revenue = num(r.revenue);
    const profit = num(r.profit);
    return { commodity: String(r.commodity), revenue, cost: num(r.cost), profit, margin: marginPct(profit, revenue) };
  });
}

export async function getLedgerFeed(range: ReportRange, limit = 20): Promise<LedgerRow[]> {
  const { from, to } = rangeBounds(range, new Date());
  const supabase = await createClient();
  let query = supabase
    .from("invoices")
    .select("id, invoice_no, type, amount, currency, due_date, status, clients(name)")
    .order("due_date", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (from) query = query.gte("due_date", from);
  if (to) query = query.lte("due_date", to);

  const { data } = await query;
  type Row = {
    id: string; invoice_no: string; type: "receivable" | "payable"; amount: unknown;
    currency: string; due_date: string | null; status: string; clients: { name: string } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: r.id,
    invoice_no: r.invoice_no,
    type: r.type,
    client: r.clients?.name ?? null,
    amount: num(r.amount),
    currency: r.currency,
    due_date: r.due_date,
    status: r.status,
  }));
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/reports.ts
git commit -m "feat(reports): server-only data layer wrapping the P&L rpcs and ledger feed"
```

---

## Task 4: Reports page

**Files:**
- Modify: `src/app/(app)/reports/page.tsx`

**Interfaces:**
- Consumes: `getPnlSummary`, `getCommodityPerformance`, `getLedgerFeed`, `type ReportRange`, `RANGE_LABELS`; `getAccountsSummary` (finance); `requireCapability`, `BlockedScreen`.

- [ ] **Step 1: Write the page**

Replace `src/app/(app)/reports/page.tsx`:

```tsx
import Link from "next/link";

import { requireCapability } from "@/lib/auth";
import { BlockedScreen } from "@/components/blocked-screen";
import { getPnlSummary, getCommodityPerformance, getLedgerFeed } from "@/lib/reports";
import { getAccountsSummary } from "@/lib/finance";
import { marginPct, RANGE_LABELS, type ReportRange } from "@/lib/report-range";

const RANGES: ReportRange[] = ["month", "90d", "all"];
const usd = (n: number) => `USD ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const money = (n: number, ccy: string) => `${ccy} ${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${n.toFixed(1)}%`;
const neg = (n: number) => (n < 0 ? "text-destructive" : "");

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const gate = await requireCapability("view_financials");
  if (!gate.allowed) return <BlockedScreen required="view_financials" role={gate.role} />;

  const sp = await searchParams;
  const range: ReportRange = RANGES.includes(sp.range as ReportRange) ? (sp.range as ReportRange) : "90d";

  const [summary, commodities, ledger, exposure] = await Promise.all([
    getPnlSummary(range),
    getCommodityPerformance(range),
    getLedgerFeed(range),
    getAccountsSummary(),
  ]);

  const margin = marginPct(summary.gross_profit, summary.revenue);
  const liquidation = summary.revenue > 0 ? (summary.ar_collected / summary.revenue) * 100 : 0;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Balance Sheet / P&amp;L</h1>
          <p className="text-sm text-muted-foreground">Revenue, cost, and margin by {RANGE_LABELS[range].toLowerCase()}.</p>
        </div>
        <nav className="flex w-fit gap-1 rounded-lg border p-1">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={`/reports?range=${r}`}
              className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                range === r ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {RANGE_LABELS[r]}
            </Link>
          ))}
        </nav>
      </div>

      {/* Executive summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Revenue" value={usd(summary.revenue)} />
        <Stat label="Cost" value={usd(summary.cost)} />
        <Stat label="Gross profit" value={usd(summary.gross_profit)} cls={neg(summary.gross_profit)} />
        <Stat label="Margin" value={pct(margin)} cls={neg(margin)} />
      </div>

      {/* AR/AP flow */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">AR / AP flow</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Collected (AR)" value={usd(summary.ar_collected)} />
          <Stat label="Pipeline (AR outstanding)" value={usd(summary.ar_outstanding)} />
          <Stat label="Liquidation" value={pct(liquidation)} />
        </div>
      </div>

      {/* Commodity performance */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Commodity performance</h2>
        {commodities.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No invoices in this range.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr className="text-left font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Commodity</th>
                  <th className="px-4 py-2.5 text-right font-medium">Revenue</th>
                  <th className="px-4 py-2.5 text-right font-medium">Cost</th>
                  <th className="px-4 py-2.5 text-right font-medium">Profit</th>
                  <th className="px-4 py-2.5 text-right font-medium">Margin</th>
                </tr>
              </thead>
              <tbody>
                {commodities.map((c) => (
                  <tr key={c.commodity} className="border-b last:border-0">
                    <td className="px-4 py-2.5">{c.commodity}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{usd(c.revenue)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{usd(c.cost)}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${neg(c.profit)}`}>{usd(c.profit)}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${neg(c.margin)}`}>{pct(c.margin)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Currency exposure */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Currency exposure</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {exposure.positions.map((p) => (
            <div key={p.currency} className="flex flex-col gap-2 rounded-xl border p-5">
              <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">{p.currency}</span>
              <span className={`text-lg font-semibold tabular-nums ${neg(p.net)}`}>{money(p.net, p.currency)}</span>
              <span className="text-xs text-muted-foreground">
                AR {money(p.ar_outstanding, p.currency)} · AP {money(p.ap_outstanding, p.currency)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Ledger activity */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Ledger activity</h2>
        {ledger.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            No invoices in this range.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr className="text-left font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Invoice</th>
                  <th className="px-4 py-2.5 font-medium">Type</th>
                  <th className="px-4 py-2.5 font-medium">Client</th>
                  <th className="px-4 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-4 py-2.5 font-medium">Due</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((l) => (
                  <tr key={l.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5 font-mono text-xs">{l.invoice_no}</td>
                    <td className="px-4 py-2.5">{l.type === "receivable" ? "AR" : "AP"}</td>
                    <td className="px-4 py-2.5">{l.client ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{money(l.amount, l.currency)}</td>
                    <td className="px-4 py-2.5 tabular-nums text-muted-foreground">{l.due_date ?? "—"}</td>
                    <td className="px-4 py-2.5 capitalize text-muted-foreground">{l.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, cls }: { label: string; value: string; cls?: string }) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border p-5">
      <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={`text-2xl font-semibold tabular-nums ${cls ?? ""}`}>{value}</span>
    </div>
  );
}
```

- [ ] **Step 2: Typecheck, lint, build**

Run: `npx tsc --noEmit && npx eslint "src/app/(app)/reports/page.tsx" src/lib/reports.ts && npx next build`
Expected: all clean.

- [ ] **Step 3: Verify the route serves**

With the dev server running, `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/reports` → `307` (redirects to login unauthenticated), proving it compiles.

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/reports/page.tsx"
git commit -m "feat(reports): balance sheet / P&L screen with range selector and commodity table"
```

---

## Task 5: Acceptance script + final gates

**Files:**
- Create: `scripts/verify-reports.ts`

**Interfaces:**
- Consumes: `@supabase/supabase-js`, `.env.local` (owner + management logins).

- [ ] **Step 1: Write the acceptance script**

Create `scripts/verify-reports.ts`:

```ts
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
  const { data: lots } = await owner.from("lots").select("id, commodities!inner(name)");
  const lotIds = new Set(
    (lots ?? []).filter((l: { commodities: { name: string } }) => l.commodities.name === target.commodity).map((l: { id: string }) => l.id),
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
```

- [ ] **Step 2: Run the acceptance script**

Run: `npx tsx scripts/verify-reports.ts`
Expected: all checks PASS.

- [ ] **Step 3: Run the full gate suite**

Run: `npx vitest run && npx tsc --noEmit && npx eslint . && npx next build`
Expected: all tests pass, no type/lint errors, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-reports.ts
git commit -m "test(reports): Phase 8 acceptance verification"
```

- [ ] **Step 5: Finish the branch**

Announce: "I'm using the finishing-a-development-branch skill to complete this work." Then follow superpowers:finishing-a-development-branch — verify tests, present the four options, execute the choice.

---

## Self-Review Notes

- **Spec coverage:** date-range selector (Tasks 2,4), executive summary revenue/cost/profit/margin (Tasks 1,3,4), AR/AP flow collected/pipeline/liquidation (Tasks 1,4), commodity performance with negatives-in-red (Tasks 1,4), currency exposure via `getAccountsSummary` (Task 4), ledger feed (Tasks 3,4). Aggregation in SQL (Task 1). Verify: hand-check commodity margin → Task 5.
- **Type consistency:** `PnlSummary`/`CommodityRow`/`LedgerRow` (Task 3) consumed by Task 4; `ReportRange`/`rangeBounds`/`marginPct`/`RANGE_LABELS` (Task 2) consumed by Tasks 3,4; `CurrencyPosition` fields (`ar_outstanding`, `ap_outstanding`, `net`) match `src/lib/finance.ts`.
- **Financial gating:** page gated `view_financials`; SQL functions `SECURITY INVOKER` so Management's rpc returns zeros (asserted in Task 5).
- **No placeholders:** every code step is complete. `report_pnl_summary` returns a single aggregate row (`rpc` yields a one-element array; the data layer takes `[0]`).
```