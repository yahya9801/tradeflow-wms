# Phase 3 — Warehouses & Sheds (Design)

**Date:** 2026-07-15
**Project:** TradeFlow WMS
**Phase:** 3 of 10 (see `PLAN.md`)
**Status:** Approved

## Goal

Turn the Warehouse module into a real, data-backed surface: a warehouses list
with capacity/occupancy, a facility detail with per-shed breakdown, a
**clickable historical-lot list per shed** (an explicit demo gap fix), and
Owner-only warehouse/shed CRUD. Occupancy is derived from stored lots in SQL.

This is the first phase whose screens render real data rather than placeholders,
so it is also the first real test of the production-UI bar.

## Context

Already in place from earlier phases:

- **Phase 1 DB:** `warehouses(id, name, address, capacity_mt)`,
  `sheds(id, warehouse_id, name, capacity_mt)`, `lots(shed_id, warehouse_id,
  status, quantity_mt, …)`, and the `shed_occupancy` view
  (`stored_mt`, `occupancy_pct`, counting only `status='stored'`).
  RLS: sheds/warehouses readable by any authenticated user, writable by
  `is_owner()` only. `settings.low_stock_threshold_pct = 80` is seeded.
- **Phase 2 auth:** `requireCapability()`, `BlockedScreen`, `usePermissions()`,
  `can(role, capability)`.
- **Seeded data:** 2 warehouses, 6 sheds, 100 lots (17 stored).

Observed facts that drove the design:

- Dispatched/delivered lots have `shed_id = NULL` — there is currently **no**
  per-shed history to display.
- Warehouses are rated above the sum of their sheds (Harbour 12,000 vs 7,923;
  Inland 8,000 vs 6,121), so "capacity" needs an explicit definition.

## Decisions (approved)

1. **Add a `lot_movements` table** to record shed history (rather than
   backfilling `lots.shed_id`).
2. **Interval / stay model:** one row per stay, `removed_at IS NULL` = still in
   the shed.
3. **`lots.shed_id` stays authoritative** for *current* location (per
   `CLAUDE.md` §3); a DB trigger writes `lot_movements` history so the two
   cannot drift.
4. **Occupancy is measured against shed capacity**, with the warehouse's rated
   capacity shown separately alongside unallocated space.
5. **Deleting a shed that has lots is blocked** with an explanation.
6. **Shed history is its own route**, not a drawer.

### A correction carried into this spec

The NULL `shed_id` on dispatched/delivered lots was initially called a seed bug.
Under decision 3 it is **correct**: if `lots.shed_id` means *where the lot is
now*, a dispatched lot has no shed. Its past lives in `lot_movements`.
Consequently `lots` needs no change and the Phase 1 `shed_occupancy` view stays
valid as-is.

## Architecture

### `lot_movements` (migration `0010_lot_movements.sql`)

```sql
create table lot_movements (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references lots(id) on delete cascade,
  shed_id uuid not null references sheds(id),   -- no cascade → shed delete blocks
  placed_at timestamptz not null default now(),
  removed_at timestamptz,                       -- NULL = still in the shed
  created_at timestamptz not null default now(),
  constraint stay_interval_valid check (removed_at is null or removed_at >= placed_at)
);
create index on lot_movements (shed_id);
create index on lot_movements (lot_id);
create unique index one_open_stay_per_lot on lot_movements (lot_id) where removed_at is null;
```

The partial unique index encodes a real business rule: **a lot can only be in
one shed at a time.**

**Sync trigger** on `lots` (AFTER INSERT OR UPDATE), `SECURITY DEFINER`:

- becomes `stored` with a `shed_id` → close any open stay, open a new one
- `shed_id` changes while `stored` → close the old stay, open a new one
- leaves `stored` (`dispatched`/`delivered`) or `shed_id` becomes NULL → close
  the open stay

This is what keeps Phase 4's status transitions from silently desynchronising
history.

**RLS:** `select` for any authenticated user (operational data, no financials);
`insert/update` for owner+management, matching the `lots` policy.

**Invariant:** `count(open stays) == count(lots where status='stored')`. Both the
seed and the trigger must preserve it; it is an explicit verification check.

### `warehouse_occupancy` (same migration)

```sql
create view warehouse_occupancy with (security_invoker = on) as
select
  w.id as warehouse_id,
  w.name,
  w.capacity_mt                      as rated_capacity_mt,
  coalesce(sum(s.capacity_mt), 0)    as shed_capacity_mt,
  coalesce(sum(so.stored_mt), 0)     as stored_mt,
  case when coalesce(sum(s.capacity_mt),0) > 0
    then round(coalesce(sum(so.stored_mt),0) / sum(s.capacity_mt) * 100, 1)
    else 0 end                       as occupancy_pct,
  count(s.id)                        as shed_count
from warehouses w
left join sheds s on s.warehouse_id = w.id
left join shed_occupancy so on so.shed_id = s.id
group by w.id, w.name, w.capacity_mt;
```

- **Occupancy denominator = shed capacity.** Goods only physically live in
  sheds, so this is the honest fullness number, and it lets the 80% alert
  actually fire.
- **Rated capacity is shown as context**, with
  `unallocated = rated_capacity_mt - shed_capacity_mt` (Harbour: 4,077 MT).

### Seed changes

Synthesize stays so the gap fix has data:

- `stored` lots → one **open** stay (`placed_at` ≈ `arrival_date`,
  `removed_at` NULL) in the lot's `shed_id`.
- `dispatched`/`delivered` lots → one **closed** stay, `removed_at` ≈
  `dispatch_date`, `placed_at` ≈ `arrival_date` (so `placed_at < removed_at`).
  The shed is chosen **from the lot's own `warehouse_id`** — a lot must never
  appear in the history of a warehouse it was never associated with.
- `pending`/`in_transit`/`received` lots → no stays (never reached a shed).

History for the 32 dispatched/delivered lots is **synthesized, not recovered** —
which shed they actually occupied was never recorded.

## Screens

| Route | Contents |
|---|---|
| `/warehouses` | Capacity card per warehouse: occupancy bar + %, stored vs shed capacity, shed count; rated capacity and unallocated as secondary. Alert state at ≥ threshold. Owner: "New warehouse". |
| `/warehouses/[id]` | Facility header (address, rated, allocated, unallocated) + per-shed breakdown: occupancy bar, stored/capacity, lot count. Each shed links to its history. Owner: edit warehouse; add/edit/delete shed. |
| `/warehouses/[id]/sheds/[shedId]` | **The gap fix.** That shed's full lot history: lot number, commodity, client, quantity MT, placed → removed (or "Currently stored"), duration in days, status. Rows link to lot detail (a Phase 4 placeholder for now). |

All three require `view_operations`, so Management can see them; they contain no
financial columns.

### Alert threshold

Read `settings.low_stock_threshold_pct` (seeded 80) from the database — never
hardcoded. `CLAUDE.md` requires these preference values to genuinely drive alert
logic. At or above the threshold, the occupancy bar takes a warning state; over
100% takes a critical state.

## CRUD (Owner only)

- Server Actions + **Zod** validation, shared client/server.
- shadcn **Dialog** for create/edit — directly fixes the demo's un-closable
  modal ("×" that did nothing).
- Fields: warehouse `name`, `address`, `capacity_mt` (rated); shed `name`,
  `capacity_mt`.
- RLS already enforces Owner-only writes via `is_owner()`. Hiding buttons with
  `usePermissions()` is cosmetic; the database is the mechanism.
- **Delete is blocked with a real reason**, e.g. *"Shed B holds 4 stored lots and
  7 historical records. Move them before deleting."* Trade history is never
  silently destroyed.

### Audit

Every warehouse/shed create/edit/delete writes an `audit_log` entry
(`action`, `entity_type`, `entity_id`, `details` with old→new values).

Not listed in Phase 3's bullets, but Phase 9's verify requires *"every mutation
from Phases 3–8 appears in the log"* — so auditing has to begin here or that
check fails later.

## UI direction (production-grade)

Driven through the `frontend-design` skill at implementation time. The occupancy
bars and capacity cards are meters/stat tiles, so the `dataviz` skill applies to
those specifically — consistent colour semantics for normal / warning / over
state, accessible in light and dark.

Quality floor: responsive (warehouse detail is a warehouse-floor screen, per
`PLAN.md` Phase 10), visible keyboard focus, real empty states (a warehouse with
no sheds; a shed with no history).

## Error handling

- Delete blocked → explain what blocks it and how to proceed; never a raw FK error.
- Non-existent warehouse/shed id → `notFound()` (404), not a crash.
- Shed id that doesn't belong to the warehouse in the URL → 404 rather than
  rendering mismatched data.
- Zod failures → inline field errors; the Dialog stays open with values intact.
- Management reaching a write path directly → refused by RLS; surfaced as an
  error, not a silent no-op.

## Verification

- **Capacities sum correctly:** Σ(shed `stored_mt`) == warehouse `stored_mt`;
  occupancy % hand-checked against raw lots for one warehouse.
- **History filters correctly:** shed X's page lists only lots with movements in
  shed X; counts match a direct SQL query.
- **Invariant:** `count(open stays) == count(stored lots)` after seeding.
- **RBAC:** Management sees the screens but no CRUD controls; a direct write is
  refused by RLS. Owner CRUD succeeds.
- **Audit:** each Owner mutation appears in `audit_log`; `verify_audit_chain()`
  still returns NULL.
- **Delete guard:** deleting an occupied shed is blocked with the explanation.
- `npm test`, `tsc --noEmit`, `lint`, `build` all clean.

## Out of scope (deferred)

- Auto-creating `low_capacity` exceptions above the threshold (Phase 7) — Phase 3
  only renders the alert state.
- Lot detail / lot CRUD / status transitions (Phase 4). Movement rows are written
  by the trigger; nothing in Phase 3 changes a lot's status.
- The Audit Log *screen* (Phase 9) — Phase 3 writes entries but does not display them.
- Warehouse-level CSV export (Phase 10).
