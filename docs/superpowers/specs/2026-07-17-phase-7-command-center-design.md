# Phase 7 — Exception Engine + Executive Dashboard + Live Ops — Design Spec

**Date:** 2026-07-17
**Branch:** `phase-7-command-center`
**Status:** Approved (design), pending implementation plan

## Goal

Auto-generate the §3 exceptions in the database, surface every open exception in
an Action Center that links to the lot where it is now visible and resolvable
(the demo-gap fix), and build the Executive Dashboard and Live Ops command
centre on top of that foundation.

## Scope (from PLAN.md Phase 7)

- Exception generation (DB triggers or on-write checks) for all §3 rules;
  resolve flow writes audit entries.
- Executive Dashboard: net position (gated), pipeline MT/FCL, storage gauge,
  cash-flow breakdown (gated), Action Center (links to lots where the exception
  is now actually visible), quick actions, recent activity, per-warehouse
  capacity.
- Live Ops: stat cards, pipeline by carrier, severity-tagged alert list,
  TanStack Table grid grouped by status bucket with buyer filter; financial
  columns simply absent for non-financial roles (no "Redacted" placeholders).
- Optional: Supabase Realtime so the grid updates live.
- **Verify:** create a lot In Transit without B/L → exception appears on
  Dashboard AND its Lot Detail; resolve it → disappears everywhere.

## Build order (one branch)

Engine first — it is foundational and it is what the verify checklist targets:

1. Migration + exception-generation engine.
2. Exception data layer + Action Center + manual "Flag issue" + surface on Lot
   Detail (the resolve flow already exists from Phase 4).
3. Executive Dashboard.
4. Live Ops + Realtime.

## What already exists (build on, do not rebuild)

- `exceptions` table (Phase 1): `id, lot_id → lots(on delete cascade), type
  exception_type, severity exception_severity, description, status
  exception_status default 'open', resolved_by → profiles, resolved_at, note,
  created_at`. Enums: `exception_type ('weight_shortage','missing_bl',
  'missing_payment_terms','compliance_block','overdue_invoice','low_capacity')`,
  `exception_severity ('critical','warning','notice')`, `exception_status
  ('open','resolved')`. Index: `exceptions (lot_id) where status='open'`.
- Exception RLS (Phase 1): `exc_select using (true)` (everyone reads),
  `exc_write for all using current_app_role() in ('owner','management')`.
  **Consequence:** the exceptions table is operationally visible to all roles —
  so exception *descriptions must not contain financial amounts* (see Financial
  gating below).
- `resolveException` server action (Phase 4, `src/app/(app)/lots/actions.ts`):
  resolves an exception with a required note, `manage_lots`-gated, audit-logged
  (`writeAudit("resolve", "exception", id, …)`). Reused unchanged.
- `getLotExceptions` (`src/lib/lots.ts`) and `ExceptionList`
  (`src/app/(app)/lots/[id]/exception-list.tsx`) already render + resolve
  exceptions on Lot Detail.
- `enforce_lot_rules()` trigger (Phase 4, migrations 0011/0012): enforces
  transition legality + shed capacity. It does **not** generate exceptions; the
  new generation trigger is separate so the two concerns stay independent.
- Occupancy view (Phase 3, migration 0008) and warehouse occupancy data layer —
  reused for the storage gauge and per-warehouse capacity.
- `getAccountsSummary()` (`src/lib/finance.ts`, Phase 6) — net position and
  AR/AP outstanding per currency, RLS-filtered — reused for the gated dashboard
  widgets.
- `getPipeline()` (`src/lib/lots.ts`, Phase 5) — status-bucketed pipeline —
  reused for pipeline MT/containers.
- `writeAudit`, the append-only hash-chained `audit_log` (Owner-only read).
- UI patterns: server components + `requireCapability` gate + `BlockedScreen`;
  `can(role, capability)`; Dialog pattern (`client-dialog.tsx`); URL-driven
  filters (`client-filters.tsx`); Tailwind bars (aging/occupancy).

## Architecture

Five layers:

1. **Schema migration** — idempotency index, the generation trigger on `lots`,
   `refresh_overdue_exceptions()`, and the Realtime publication. The only new
   DB objects.
2. **Exception data layer** (`src/lib/exceptions.ts`, server-only) — open-
   exception reads + severity stats, joined to lot numbers.
3. **Dashboard data layer** (`src/lib/dashboard.ts`, server-only) — assembles
   the operational + (gated) financial widgets, reusing Phase 3/5/6 layers.
4. **Live Ops data layer** (`src/lib/live-ops.ts`, server-only) — the grid rows
   (financial columns present only for financial roles) + carrier grouping.
5. **UI + client islands** — Recharts gauge, TanStack Table grid, the Realtime
   subscription hook, the manual "Flag issue" dialog, and the Action Center
   shared component.

## 1. Schema migration — `supabase/migrations/0014_exceptions_engine.sql`

Schema is sacred (PLAN §5.3): reviewed before it runs.

### 1a. Idempotency

```sql
create unique index exceptions_one_open_per_type
  on exceptions (lot_id, type) where status = 'open';
```

At most one open exception per (lot, type). Generation upserts with
`on conflict … do nothing`; auto-resolution flips `status` so a later
re-occurrence can open a fresh row.

### 1b. Generation trigger on `lots`

`security definer`, AFTER INSERT OR UPDATE. Helper to open/resolve one type:

```sql
create or replace function public.gen_lot_exception(
  p_lot uuid, p_type exception_type, p_sev exception_severity,
  p_active boolean, p_desc text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_active then
    insert into exceptions (lot_id, type, severity, description)
    values (p_lot, p_type, p_sev, p_desc)
    on conflict (lot_id, type) where status = 'open' do nothing;
  else
    update exceptions
       set status = 'resolved', resolved_at = now(),
           note = coalesce(note, 'Auto-resolved: condition cleared')
     where lot_id = p_lot and type = p_type and status = 'open';
  end if;
end $$;

create or replace function public.sync_lot_exceptions() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  -- settings.value is jsonb; extract the scalar, then cast. Key may be unseeded,
  -- so default to 80 (PLAN §3 default threshold).
  threshold numeric := coalesce(
    (select (value #>> '{}')::numeric from settings where key = 'low_stock_threshold_pct'), 80);
  shed_cap numeric;
  shed_used numeric;
  occ numeric;
begin
  perform gen_lot_exception(
    new.id, 'missing_bl', 'warning',
    new.status = 'in_transit' and new.bl_number is null,
    'Lot ' || new.lot_number || ' is In Transit without a B/L number.');

  perform gen_lot_exception(
    new.id, 'missing_payment_terms', 'warning',
    new.direction = 'export' and new.payment_terms is null,
    'Export lot ' || new.lot_number || ' has no payment terms.');

  -- low_capacity is always evaluated so it auto-resolves when this lot leaves
  -- the shed (new.status <> 'stored' → active=false → resolve). It stays a
  -- per-lot alert; occupancy changes from OTHER lots are not retro-resolved.
  occ := 0;
  if new.status = 'stored' and new.shed_id is not null then
    select s.capacity_mt,
           coalesce(sum(l.quantity_mt) filter (where l.status = 'stored'), 0)
      into shed_cap, shed_used
      from sheds s left join lots l on l.shed_id = s.id
     where s.id = new.shed_id group by s.capacity_mt;
    occ := case when shed_cap > 0 then shed_used / shed_cap * 100 else 0 end;
  end if;
  perform gen_lot_exception(
    new.id, 'low_capacity',
    case when occ >= 100 then 'critical' else 'warning' end,
    new.status = 'stored' and occ > threshold,
    'Shed at ' || round(occ) || '% capacity after storing ' || new.lot_number || '.');

  return new;
end $$;

create trigger lots_sync_exceptions
  after insert or update on lots
  for each row execute function sync_lot_exceptions();
```

Notes:
- Runs after `enforce_lot_rules` (alphabetical trigger order is irrelevant here;
  generation reads `new`, never blocks). Seed/service context (`auth.uid()`
  null) is unaffected — generation is harmless during seeding and keeps state
  correct.
- Auto-generated rows carry no `resolved_by` (system), matching the "not
  individually audit-logged" decision.

### 1c. `refresh_overdue_exceptions()`

Materialises overdue-invoice exceptions; called when the dashboard/Action
Center loads. **Description carries no amount** (the exceptions table is world-
readable):

```sql
create or replace function public.refresh_overdue_exceptions() returns void
language plpgsql security definer set search_path = public as $$
begin
  -- Open a row for each newly-overdue, unpaid invoice.
  insert into exceptions (lot_id, type, severity, description)
  select i.lot_id, 'overdue_invoice', 'warning',
         'Invoice ' || i.invoice_no || ' (' || c.name || ') is past due.'
    from invoices i join clients c on c.id = i.client_id
   where i.due_date < current_date and i.status <> 'paid'
     and not exists (
       select 1 from exceptions e
        where e.type = 'overdue_invoice' and e.status = 'open'
          and e.description like 'Invoice ' || i.invoice_no || ' %');

  -- Resolve rows whose invoice is now paid or no longer past due.
  update exceptions e set status = 'resolved', resolved_at = now(),
         note = coalesce(e.note, 'Auto-resolved: invoice settled')
   where e.type = 'overdue_invoice' and e.status = 'open'
     and not exists (
       select 1 from invoices i
        where i.due_date < current_date and i.status <> 'paid'
          and e.description like 'Invoice ' || i.invoice_no || ' %');
end $$;

grant execute on function public.refresh_overdue_exceptions() to authenticated;
```

Overdue exceptions may have a null `lot_id` (invoices need not reference a lot);
those appear in the Action Center but not on any Lot Detail. Matching an
existing open row by `invoice_no` embedded in the description keeps the function
idempotent without a schema change to `exceptions` (no `invoice_id` column in
v1 — noted as a deliberate simplification).

### 1d. Realtime publication

```sql
-- Idempotent: adding a table already in the publication raises, so guard it.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and tablename = 'lots') then
    alter publication supabase_realtime add table lots;
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and tablename = 'exceptions') then
    alter publication supabase_realtime add table exceptions;
  end if;
end $$;
```

RLS still governs which rows a subscriber receives.

## 2. Exception data layer + Action Center + manual flag

### 2a. `src/lib/exceptions.ts` (server-only)

```ts
export type OpenException = {
  id: string;
  lot_id: string | null;
  lot_number: string | null;
  type: string;
  severity: "critical" | "warning" | "notice";
  description: string;
  created_at: string;
};
export type ExceptionStats = { critical: number; warning: number; notice: number; total: number };

// getOpenExceptions(limit?): OpenException[]  — status='open', joined lots(lot_number),
//   ordered critical→warning→notice then created_at desc.
// getExceptionStats(): ExceptionStats
// refreshOverdue(): Promise<void>  — rpc('refresh_overdue_exceptions')
```

The dashboard and Live Ops call `refreshOverdue()` before reading, so overdue
rows are current.

### 2b. Manual "Flag issue" — `src/app/(app)/lots/[id]/flag-issue-dialog.tsx` + action

`flagException` server action in `lots/actions.ts`: `requireCapability
("manage_lots")`, Zod-validated (`type ∈ {weight_shortage, compliance_block}`,
`severity`, `description 5–300`), insert into `exceptions`, `writeAudit
("flag","exception",…)`, `revalidatePath('/lots/[id]')`. The dialog opens from
the Lot Detail exceptions header (mirrors the Phase 6 "Raise invoice" placement).

### 2c. Action Center — `src/components/action-center.tsx`

Shared server component: severity-dot + description + a link to `/lots/[id]`
(when `lot_id` present). Reused on Dashboard and Live Ops. This is the demo-gap
fix — every flag links to a lot where the record is real and resolvable.

## 3. Executive Dashboard — `src/app/(app)/dashboard/page.tsx`

Gate `view_operations`. `src/lib/dashboard.ts` assembles:

- **Pipeline MT / containers** (operational) — from `getPipeline` both
  directions: total MT in transit / stored, lot counts.
- **Storage gauge** (operational) — overall occupancy % across sheds, rendered
  with a Recharts `RadialBarChart` client island
  (`src/components/storage-gauge.tsx`).
- **Per-warehouse capacity** (operational) — occupancy bars per warehouse
  (Tailwind, reusing the Phase 3 occupancy source).
- **Net position + cash-flow breakdown** (gated `view_financials`) — from
  `getAccountsSummary`; rendered only when `can(role,"view_financials")`, and the
  data is RLS-filtered regardless.
- **Action Center** — `getOpenExceptions()` after `refreshOverdue()`.
- **Quick actions** — links (New lot, New invoice [gated], Warehouses, Clients).
- **Recent activity** — recent lots + recently-opened/resolved exceptions
  (operational sources; **not** `audit_log`, which is Owner-only by RLS — full
  audit lives on the Phase 9 Audit screen).

## 4. Live Ops — `src/app/(app)/live-ops/page.tsx`

Gate `view_operations`. `src/lib/live-ops.ts` returns grid rows:

```ts
export type LiveRow = {
  id: string; lot_number: string; direction: "import" | "export";
  status: string; commodity: string; client: string; buyer: string | null;
  carrier: string | null; quantity_mt: number; bags: number;
  market_value: number | null;   // NULL for non-financial roles (lots_view masks it)
};
```

- **Stat cards** — counts by status bucket; a gated total-value card.
- **Pipeline by carrier** — group lots by `vessel_name`.
- **Severity-tagged alert list** — `getOpenExceptions()`.
- **Grid** — `src/components/live-grid.tsx`, a **TanStack Table** client island
  grouped by status bucket, sortable, with a **buyer filter**. The market-value
  column is only included when `can(role,"view_financials")` — for other roles
  the column is absent (RLS already nulls it; the UI simply omits it, no
  "Redacted" text).
- **Realtime** — `src/components/use-realtime-refresh.ts`: subscribes to
  `postgres_changes` on `lots` and `exceptions`; on any change calls
  `router.refresh()` (server re-render through RLS). Simpler and safer than
  client-side row patching, and keeps money masking authoritative on the server.
  Channel cleaned up on unmount.

## 5. New dependencies

- `recharts` — RadialBar storage gauge (and any bar charts).
- `@tanstack/react-table` — the Live Ops grid (grouping, sorting, filtering).

Both are client-only; server components stay server-rendered.

## 6. Testing & verification

- **Vitest unit:** the flag-issue Zod schema; a pure `severityRank` /
  bucket-ordering helper used by the Action Center and grid; the occupancy-%
  helper if any pure math is extracted.
- **Acceptance script** `scripts/verify-exceptions.ts` (signed-in clients,
  restores writes):
  1. Insert a lot In Transit with null B/L → an open `missing_bl` exception
     exists for it; it appears in `getOpenExceptions()`. Fill the B/L → the
     exception auto-resolves. (The core verify.)
  2. Export lot with null payment terms → `missing_payment_terms`; set terms →
     resolves.
  3. Store a lot that pushes a shed over threshold → `low_capacity` opens.
  4. `refresh_overdue_exceptions()` opens a row for a past-due unpaid invoice
     and resolves it once paid; the description contains no amount.
  5. Manual flag creates a `weight_shortage`; `resolveException` resolves it and
     writes an audit entry.
  6. Management can read exceptions (operational) but sees **no monetary amount**
     in any overdue description.
  All test writes cleaned up; never touch `LOT-2026-00301` or reseed.
- **Static gates:** `tsc --noEmit`, `eslint`, `next build`, `vitest run`.

## Financial gating (the rule this phase must not break)

- Exceptions are world-readable (`exc_select using(true)`), so **no exception
  description contains a monetary amount** — overdue descriptions name the
  invoice, client, and that it is past due, never the figure.
- Dashboard net-position / cash-flow widgets render only under
  `can(role,"view_financials")`, and their data comes from RLS-filtered queries
  (`getAccountsSummary`) — hiding is cosmetic on top of the DB mask.
- The Live Ops grid's market-value column is omitted for non-financial roles;
  `lots_view` already nulls `market_value` for them, so even the data path
  carries nothing.

## Defaults (explicit, changeable)

- Overdue exceptions are matched/deduped by the `invoice_no` embedded in their
  description (no `invoices.invoice_id` FK on `exceptions` in v1).
- Realtime refreshes via `router.refresh()` (server re-render), not client-side
  row patching — keeps money masking on the server.
- "Recent activity" uses operational sources, not the Owner-only `audit_log`.

## Out of scope (later phases / backlog)

- P&L / balance-sheet reporting (Phase 8).
- Audit Log screen + Settings screens (Phase 9) — this phase reads the existing
  `settings.low_stock_threshold_pct` but does not build the settings UI.
- Scheduled/cron overdue refresh (v1 refreshes on dashboard load).
- Carrier/weighbridge integrations, notifications (v2 backlog).
