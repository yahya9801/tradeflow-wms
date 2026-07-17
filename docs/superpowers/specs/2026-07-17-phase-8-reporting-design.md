# Phase 8 — Reporting: Balance Sheet / P&L — Design Spec

**Date:** 2026-07-17
**Branch:** `phase-8-reporting`
**Status:** Approved (design), pending implementation plan

## Goal

A financial reporting screen at `/reports` (gated `view_financials`) with a
date-range selector (This Month / 90 Days / All Time, filtering invoices by
**due_date**), an executive P&L summary (revenue, cost, gross profit, margin),
AR/AP flow (collected, pipeline, liquidation %), a per-commodity performance
table (revenue/cost/profit/margin, negatives in red), currency exposure, and a
ledger activity feed. All aggregation lives in SQL (PLAN §8: keep aggregation in
the database, not JS).

## Scope (from PLAN.md Phase 8)

- Date-range selector (This Month / 90 Days / All Time), executive summary
  (revenue, cost, gross profit, margin), AR/AP flow (collected, pipeline,
  liquidation %), commodity performance table (per-commodity revenue/cost/
  profit/margin, negative in red), currency exposure, ledger activity feed.
- Build on SQL views — keep aggregation in the database, not JS.
- **Verify:** hand-check one commodity's margin against raw invoices.

## Recognition model (decided)

- **Reporting date basis = invoice `due_date`.** The range selector filters
  invoices by `due_date`. (Chosen over `created_at`: the seed clusters
  `created_at` at seed time but spreads `due_date` ±40 days, so the selector is
  visibly functional. Reads as "expected settlement period".)
- **Revenue / cost = accrual** — the invoice `amount`. Export lots carry
  `receivable` invoices (revenue); import lots carry `payable` invoices (cost).
- **Collected / pipeline = cash** — `amount_paid` and outstanding
  (`amount − amount_paid`).
- **Liquidation % = ar_collected ÷ revenue** (guarded against divide-by-zero).
- **Margin % = profit ÷ revenue** (guarded), computed in the app; negative
  profit/margin renders in red.
- **Executive summary is USD.** All seed invoices are USD, so a single-currency
  P&L is faithful; the **currency exposure** section is the general per-currency
  view (reusing Phase 6 `getAccountsSummary`).
- **Null `due_date`:** an invoice with no due date is excluded from bounded
  ranges (This Month, 90 Days) and included only in All Time (open bounds).

## What already exists (build on, do not rebuild)

- `invoices` (Phase 1/6): `type (receivable|payable)`, `status`, `currency`,
  `amount`, `amount_paid`, `due_date`, `lot_id → lots (on delete set null)`,
  `client_id`. RLS `inv_select using (can_view_financials())` — Management reads
  nothing. Payments ledger + derivation triggers (Phase 6).
- `lots.commodity_id → commodities`; `commodities.name`.
- `getAccountsSummary()` (`src/lib/finance.ts`, Phase 6) — per-currency AR/AP
  outstanding + net position, RLS-filtered. Reused for currency exposure.
- `can_view_financials()` SQL helper; `can(role, "view_financials")`.
- `/reports` placeholder page, already gated on `view_financials`.
- UI patterns: server component + `requireCapability` gate + `BlockedScreen`;
  URL-driven segmented controls (Phase 6 accounts tabs); Tailwind stat cards and
  tables; the shared `money()` formatter idiom.

## Architecture

1. **Schema migration** — SQL aggregation functions (the only new DB objects).
2. **Pure helpers** (`src/lib/report-range.ts`) — date-bound computation and
   margin, unit-tested without a DB.
3. **Server-only data layer** (`src/lib/reports.ts`) — thin wrappers over the
   SQL functions + the ledger query; reuses `getAccountsSummary`.
4. **UI** — the `/reports` screen, a server component with a URL-driven range.

## 1. Schema migration — `supabase/migrations/0015_reporting.sql`

Schema is sacred (PLAN §5.3): reviewed before it runs. Functions are
`SECURITY INVOKER` (the default) so invoice RLS applies — Management calling
them gets zero rows, matching the gated page.

### 1a. P&L summary

```sql
create or replace function public.report_pnl_summary(p_from date, p_to date)
returns table (
  revenue numeric, cost numeric, gross_profit numeric,
  ar_collected numeric, ar_outstanding numeric, ap_outstanding numeric
) language sql stable as $$
  with scoped as (
    select * from invoices
     where (p_from is null or (due_date is not null and due_date >= p_from))
       and (p_to   is null or (due_date is not null and due_date <= p_to))
  )
  select
    coalesce(sum(amount) filter (where type = 'receivable'), 0) as revenue,
    coalesce(sum(amount) filter (where type = 'payable'), 0)    as cost,
    coalesce(sum(amount) filter (where type = 'receivable'), 0)
      - coalesce(sum(amount) filter (where type = 'payable'), 0) as gross_profit,
    coalesce(sum(amount_paid) filter (where type = 'receivable'), 0) as ar_collected,
    coalesce(sum(amount - amount_paid) filter (where type = 'receivable'), 0) as ar_outstanding,
    coalesce(sum(amount - amount_paid) filter (where type = 'payable'), 0)    as ap_outstanding
  from scoped;
$$;
```

### 1b. Per-commodity performance

```sql
create or replace function public.report_by_commodity(p_from date, p_to date)
returns table (commodity text, revenue numeric, cost numeric, profit numeric)
language sql stable as $$
  with scoped as (
    select i.type, i.amount, c.name as commodity
      from invoices i
      left join lots l on l.id = i.lot_id
      left join commodities c on c.id = l.commodity_id
     where (p_from is null or (i.due_date is not null and i.due_date >= p_from))
       and (p_to   is null or (i.due_date is not null and i.due_date <= p_to))
  )
  select
    coalesce(commodity, 'Unattributed') as commodity,
    coalesce(sum(amount) filter (where type = 'receivable'), 0) as revenue,
    coalesce(sum(amount) filter (where type = 'payable'), 0)    as cost,
    coalesce(sum(amount) filter (where type = 'receivable'), 0)
      - coalesce(sum(amount) filter (where type = 'payable'), 0) as profit
  from scoped
  group by coalesce(commodity, 'Unattributed')
  order by profit desc;
$$;

grant execute on function public.report_pnl_summary(date, date),
                        public.report_by_commodity(date, date) to authenticated;
```

Invoices with no lot (`lot_id` null) fall into the **"Unattributed"** row, so
the commodity table's revenue/cost sums reconcile with the summary.

## 2. Pure helpers — `src/lib/report-range.ts`

```ts
export type ReportRange = "month" | "90d" | "all";

export type Bounds = { from: string | null; to: string | null }; // ISO dates

export function rangeBounds(range: ReportRange, today: Date): Bounds {
  // month  → first-of-month … today
  // 90d    → today-90 … today
  // all    → null … null
}

export function marginPct(profit: number, revenue: number): number {
  return revenue > 0 ? (profit / revenue) * 100 : 0;
}

export const RANGE_LABELS: Record<ReportRange, string> = {
  month: "This Month", "90d": "90 Days", all: "All Time",
};
```

Unit-tested: `rangeBounds` for each range (month start, 90-day offset, all=null),
`marginPct` including the zero-revenue guard.

## 3. Data layer — `src/lib/reports.ts` (server-only)

```ts
export type PnlSummary = {
  revenue: number; cost: number; gross_profit: number;
  ar_collected: number; ar_outstanding: number; ap_outstanding: number;
};
export type CommodityRow = {
  commodity: string; revenue: number; cost: number; profit: number; margin: number;
};
export type LedgerRow = {
  id: string; invoice_no: string; type: "receivable" | "payable";
  client: string | null; amount: number; currency: string; due_date: string | null; status: string;
};

// getPnlSummary(range): PnlSummary          — rpc report_pnl_summary(from,to)
// getCommodityPerformance(range): CommodityRow[]  — rpc report_by_commodity; adds marginPct
// getLedgerFeed(range, limit?): LedgerRow[]  — invoices in range, joined clients(name), by due_date desc
```

Currency exposure reuses `getAccountsSummary()` from `finance.ts` — no new query.

## 4. UI — `src/app/(app)/reports/page.tsx`

Gate `view_financials` (keep the existing `BlockedScreen`). URL-driven range
(`?range=month|90d|all`, default `90d`). Sections:

- **Range selector** — segmented control of `<Link>`s (Phase 6 pattern).
- **Executive summary** — cards: Revenue, Cost, Gross profit, Margin %
  (negative gross profit/margin in red).
- **AR/AP flow** — Collected, Pipeline (AR outstanding), Liquidation %.
- **Commodity performance** — table: commodity, revenue, cost, profit, margin;
  negative profit/margin cells in `text-destructive`.
- **Currency exposure** — per-currency AR/AP outstanding + net (from
  `getAccountsSummary`).
- **Ledger activity** — recent invoices in range (no, type AR/AP, client,
  amount, due, status), click-through to nothing new (read-only feed).

## 5. Testing & verification

- **Vitest unit:** `report-range.test.ts` — `rangeBounds` (month=first-of-month,
  90d=today−90, all=null/null) and `marginPct` (normal + zero-revenue guard).
- **Acceptance** `scripts/verify-reports.ts` (signed-in clients, read-only —
  makes no writes):
  1. **Hand-check one commodity's margin** (the PLAN verify): pick a commodity,
     recompute revenue = Σ receivable `amount` and cost = Σ payable `amount`
     from raw invoices joined through `lots` (All Time), and assert it equals
     the `report_by_commodity` row; assert `margin = profit/revenue`.
  2. Summary revenue (All Time) equals Σ of all receivable invoice amounts.
  3. A bounded range (90 Days) returns `revenue ≤` All-Time revenue (range
     actually filters).
  4. **Management** `rpc('report_pnl_summary', …)` returns zeroed/empty output
     (RLS blocks the underlying invoice reads).
- **Static gates:** `tsc --noEmit`, `eslint`, `next build`, `vitest run`.

## Financial gating (must not break)

- `/reports` is gated `view_financials`; the SQL functions are `SECURITY INVOKER`
  so invoice RLS returns nothing to Management even if the rpc is called
  directly — the mask is the database, the page gate is cosmetic on top.
- Currency exposure comes from `getAccountsSummary`, already RLS-filtered.

## Defaults (explicit, changeable)

- Reporting basis is `due_date`; null-due invoices appear only under All Time.
- Executive summary is USD (seed is all-USD); exposure covers all currencies.
- Margin is computed in the app (a ratio); all sums/group-bys are in SQL.
- The ledger feed is read-only (no new mutations in this phase).

## Out of scope (later phases / backlog)

- Multi-currency FX conversion / a single consolidated cross-currency P&L
  (v2 backlog, PLAN §6) — v1 reports USD and shows other currencies separately.
- CSV export of reports (Phase 10 polish).
- Audit Log + Settings screens (Phase 9).
- Balance-sheet asset/liability modelling beyond AR/AP (not in the demo scope).
