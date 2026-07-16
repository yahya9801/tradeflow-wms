# Phase 4 — Lots Core (Design)

**Date:** 2026-07-15
**Project:** TradeFlow WMS
**Phase:** 4 of 10 (see `PLAN.md`) — "the heart", the largest phase so far
**Branch:** `phase-4-lots`
**Status:** Awaiting approval

## Goal

Build the Lot lifecycle — the entity the whole product hangs off. A filterable
lots list, a direction-aware create/edit form with real validation, and a Lot
Detail screen with a working status stepper, permission-gated financials, and
**resolvable exceptions**.

This phase fixes two of the demo's named bugs:

- ❌ *"Action Center flags link to lots that show no claim/warning record."*
  → exceptions become first-class records, visible **and resolvable** on Lot Detail.
- ❌ *"No Edit/status-change controls on Lot Detail."*
  → status transitions + edit, permitted by role, all audit-logged.

## Context — verified against the live database

| Fact | Evidence |
|---|---|
| `lots_view` already exposes `bags` and a masked `market_value` | Phase 1 `0006` |
| `lot_movements` + sync trigger keep shed history in step with `status`/`shed_id` | Phase 3 `0010` |
| RLS: `lots` writable by owner+management; `invoices` readable only by `can_view_financials()` | Phase 1 `0005` |
| 6 seeded exceptions exist, all `open`, attached to real lots | seed |
| 73 lots have invoices | seed |

### Two inherited gaps this phase must close first

**1. Forward-only transitions are not enforced anywhere.**
The Phase 1 spec stated: *"Forward-only status transitions enforced by a
`BEFORE UPDATE` trigger on `lots`, with an Owner-only override."* The Phase 1
implementation plan's migration list (`0001`–`0008`) never included it, so it
silently slipped. The only trigger on `lots` today is Phase 3's
`lots_sync_movement`. This was demonstrated in Phase 3, where a lot was moved
`stored → dispatched → stored` — a backward transition — with no complaint.

**2. The seeded exceptions contradict their own lots.**

| Exception says | Lot | Reality |
|---|---|---|
| `missing_bl` | LOT-2026-00105 | has `BL-ZYJDLN4M` |
| `missing_bl` | LOT-2026-00106 | has `BL-W8FCKACT` |
| `missing_payment_terms` | LOT-2026-00102 | has `payment_terms: TT` |

The Phase 1 seed stamped fixed exception types onto random lots without checking
the lot actually violates the rule (`in_transit_no_bl: 0`, `export_no_terms: 0`
across the whole table). This **reproduces the exact demo bug** this phase is
meant to fix: Lot Detail would render "Missing B/L" beside a visible B/L number,
and "resolve" would be meaningless.

## Decisions (approved)

1. **Transitions enforced by a DB trigger**, with the UI offering only legal
   moves on top. Management can already `UPDATE lots` through RLS, so an
   app-only check could be skipped with a direct PostgREST call.
2. **Next-step only; Owner may step back one** (a correction), audit-logged.
3. **Storing into a shed without room is blocked**, with the numbers in the message.
4. **The seed is fixed to create real violations** so exceptions tell the truth.

## Architecture

### Migration `0011_lot_rules.sql`

A `BEFORE UPDATE` trigger on `lots` enforcing two physical rules:

```
lifecycle: pending(1) → in_transit(2) → received(3) → stored(4)
           → dispatched(5) → delivered(6)

on status change:
  delta = +1                  → allow
  delta = -1 and is_owner()   → allow (correction)
  otherwise                   → raise
      'LOT-2026-00042 cannot move from delivered to pending'

on new.status = 'stored':
  free = shed.capacity_mt - (stored in shed, excluding this lot)
  if free < new.quantity_mt → raise
      'Shed C has 6 MT free; LOT-2026-00042 is 420 MT'
```

**Admin bypass:** when `auth.uid() IS NULL` the trigger returns early. This is
the seed / migration / `service_role` context, which already bypasses RLS —
admin context is not subject to app rules. Without it, reseeding (which inserts
lots at arbitrary statuses and later corrects data) would break.

The capacity rule lives in the trigger rather than only the Server Action for
the same reason as the transition rule: it is a physical fact about the world,
and the database is the only place that can't be bypassed.

**Interaction with Phase 3's `lots_sync_movement`:** that trigger is `AFTER
INSERT OR UPDATE`; this one is `BEFORE UPDATE`. So the legality check runs
first, and movement history is only written for transitions that were allowed.
The Phase 3 invariant (`open stays == stored lots`) must still hold afterwards.

### Seed fix

- Pick a few `in_transit` lots → set `bl_number = NULL` → attach `missing_bl`.
- Pick a few `export` lots → set `payment_terms = NULL` → attach
  `missing_payment_terms`.
- `weight_shortage` / `compliance_block` remain human-raised claims (not
  derivable from field state) with descriptions that read like a real claim.

Result: every field-backed exception is *true*, and "resolve = fill the field"
becomes a demonstrable flow rather than theatre.

> Note the tension this creates with the form's Zod rules, which require a B/L
> for in-transit imports. That is correct and intentional: the form prevents
> *new* violations, while the seeded lots represent records that entered the
> system before the rule (or via an import). Fixing them through the UI is
> exactly the flow being demonstrated.

### Data layer — `src/lib/lots.ts`

Reads go through **`lots_view`**, never the `lots` table, so `market_value` is
masked by the database for non-financial roles. Management physically cannot
receive money from this path.

- `listLots({ q, direction, status, page }): Promise<{ rows, total }>`
- `getLot(id)`, `getLotInvoices(id)`, `getLotExceptions(id)`
- `listCommodities()`, `listClients()`, `listWarehouses()`, `listShedsWithSpace(warehouseId)`

### Screens

| Route | Contents |
|---|---|
| `/lots` | Search (lot no. / commodity / counterparty), direction filter, status tabs with counts, 25/page. **URL-driven** (`?q=&direction=&status=&page=`) so views are shareable and bookmarkable. |
| `/lots/new`, `/lots/[id]/edit` | Direction toggle swapping field sets; dependent warehouse → shed dropdown; live bags preview; Zod validation. |
| `/lots/[id]` | Header + **status stepper**, shipment / storage / counterparty / commodity cards, related invoices (**gated**), **open exceptions with resolve actions**. |

TanStack Table stays reserved for Live Ops (Phase 7), where grouping genuinely
needs it. A server-rendered list keeps Phase 4's filters in the URL and the
payload small.

### Form field sets

| | Import | Export |
|---|---|---|
| Shared | commodity, counterparty, quantity_mt, eta, notes | ← same |
| Specific | origin_country, vessel_name, **bl_number**, arrival_date | destination_country, export_ref, **payment_terms** |

**New lots are always created at `pending`.** Status is not a form field — it
only ever changes through the stepper, so the lifecycle has exactly one entry
point and forward-only can't be sidestepped at creation.

**Zod rules** (shared client + server):
- `payment_terms` required for **exports** — checked on every save
- `bl_number` required for an **import** whose status is `in_transit` or later.
  Since creation is always `pending`, this bites in exactly two places: the
  **transition action** advancing an import to `in_transit`, and **editing** a
  lot already at/past `in_transit`. A pending import needs no B/L yet, which is
  correct — the paperwork doesn't exist until it sails.
- `quantity_mt > 0`
- `lot_number` is DB-generated and never a form field
- **bags** is derived, shown live, never stored

### Status stepper

Renders the full lifecycle with the current position, and offers **only
permitted transitions** — at most two actions (advance; plus Owner's step-back).
Advancing to `stored` opens a **warehouse → shed picker** showing live free
space, with the trigger as the backstop.

### Exceptions — who does what

- **Phase 4:** display, resolve-with-note, and **auto-resolve** when the backing
  field is filled. CLAUDE.md: *"Resolving = filling the field or explicitly
  resolving with a note."*
- **Phase 7:** auto-*creation* from rules — deferred per `PLAN.md`.

So filling a B/L on a lot flagged `missing_bl` resolves that exception and
records who/when.

### Financial gating

The related-invoices card renders only when `can(role, "view_financials")`, and
the query itself is refused by RLS for Management. UI hiding is cosmetic; the
database is the mechanism. This is the rule that kills the demo's
redaction-inconsistency bug class.

### Audit

Every create / edit / transition / exception-resolve writes an `audit_log` entry
with old→new values, via the existing `writeAudit()`.

## Error handling

- Illegal transition → the trigger's message surfaced in the UI, not a raw
  Postgres error.
- Over-capacity store → free space vs lot size, stated plainly.
- Unknown lot id → `notFound()`.
- Zod failure → inline field errors; **the form keeps the user's values**
  (React 19 auto-resets uncontrolled forms after an action — Phase 3's lesson;
  inputs must be controlled).
- Management reaching a write path → refused by RLS. Note RLS does **not** error
  on `UPDATE`; it matches zero rows, so Server Actions must also gate on
  `requireCapability` or they would report a misleading success (Phase 3's other
  lesson).

## Verification

- **Full lifecycle** pending → delivered driven through the UI.
- **Shed capacity updates on store/dispatch**, and the Phase 3 invariant
  (`open stays == stored lots`) still holds afterwards.
- **Management sees the lot but no amounts anywhere on the page** — checked with
  a real Management session, not by reading the JSX.
- **Illegal transition rejected by the database** via a direct PostgREST call
  that bypasses the UI entirely.
- **Over-capacity store rejected** with the numbers.
- **A `missing_bl` exception auto-resolves** when the B/L is filled, and the
  audit records it.
- `npm test`, `tsc --noEmit`, `lint`, `build` clean.

## Out of scope (deferred)

- Exception auto-**creation** (Phase 7).
- The Action Center / dashboard surface for exceptions (Phase 7).
- Imports/Exports pipeline views and client profiles (Phase 5).
- Invoice CRUD (Phase 6) — Phase 4 only *reads* related invoices.
- CSV export (Phase 10).
