# Phase 5 — Trade Module (Design)

**Date:** 2026-07-16
**Project:** TradeFlow WMS
**Phase:** 5 of 10 (see `PLAN.md`)
**Status:** Approved

## Goal

Turn the Trade module into a real, data-backed surface: Imports and Exports
pipeline views (lots grouped by status), a Clients directory, a Client profile,
and Owner-only client CRUD. This is largely a *presentation* layer over data
Phase 4 already produced — the core work is new shapes and a new entity's CRUD,
not new lot machinery.

Two demo gaps this phase closes:
- The demo's import/export screens were static; here they are live pipelines
  whose counts are derived from the lots table.
- Client profiles show real trading history, with invoice amounts gated by the
  single financial-visibility permission (no per-screen redaction drift).

## Context — verified against the live database

| Fact | Evidence |
|---|---|
| `clients`: 50 buyers, 30 suppliers; `type` enum is `buyer` \| `supplier` \| `both` | seed |
| 56 of 80 clients have lots | seed |
| `clients` RLS: `select` for any authenticated user; **write only `is_owner()`** | Phase 1 `0005` |
| `lots` and `invoices` reference `clients` with **NO ACTION** (no cascade) | Phase 1 `0003` |
| `lots_view` masks `market_value`; `invoices` RLS returns nothing for Management | Phase 1 `0005`/`0006` |
| `listLots`, `getLotInvoices`, `getLotExceptions`, `listClients` already exist | Phase 4 `src/lib/lots.ts` |

So client CRUD is **already Owner-only at the database layer**, and a client with
history **cannot be hard-deleted** — both facts drive the design below.

## Decisions (approved)

1. **Imports/Exports are a 6-column Kanban** (Pending → Delivered), filtered to
   the route's direction.
2. **Client CRUD is Owner-only** — matches the existing RLS and the Phase 3
   warehouse precedent; no migration.
3. **Deleting a client with lots or invoices is blocked with a reason.**

## Architecture

### Imports & Exports pipeline (`/imports`, `/exports`)

Both routes render the same component with a different `direction`. They read the
existing `lots_view` — no new lot data layer, only a new shape.

New data-layer function in `src/lib/lots.ts`:

```
getPipeline(direction: "import" | "export"): Promise<{
  stats: { total: number; in_transit: number; stored: number; total_mt: number };
  columns: Record<LotStatus, PipelineCard[]>;  // one entry per lifecycle status
}>
```

`PipelineCard = { id, lot_number, commodity, client, quantity_mt, bags }`.

Layout:
- **Summary stat row** — operational only (total lots, in transit, stored,
  total MT). No money.
- **Six columns**, one per `LOT_STATUSES` entry, each with a header + count and
  its lot cards stacked inside. Empty columns still render (count 0) so the
  pipeline shape is always legible.
- **Card** — lot number (mono), commodity, counterparty, `MT · bags`. No status
  pill: the column already carries the status. Card links to Lot Detail.
- **"New Import Lot" / "New Export Lot"** button, gated on `manage_lots`, links
  to `/lots/new?direction=import|export`.
- **Responsive** — the column strip lives in an `overflow-x-auto` container so
  the columns scroll horizontally *inside their own box*; the page body never
  scrolls sideways (per the project's responsive rule). This is the accepted
  trade-off of the Kanban choice on a 6-status, data-dense screen.

**Phase 4 touch (targeted):** `src/app/(app)/lots/new/page.tsx` reads a
`direction` search param and passes it as the form's initial direction, so the
pipeline's "New … Lot" button pre-sets the toggle. The lot form already has a
direction toggle; this only changes the initial value. Nothing else in Phase 4
changes.

### Clients directory (`/clients`)

New data layer `src/lib/clients.ts`:

- `listClientsDirectory({ q, type }): Promise<{ rows: ClientRow[]; counts: { buyers, suppliers, withLots } }>`
  - `ClientRow = { id, name, type, country, lot_count }`
  - Filter `type` is `all` | `buyer` | `supplier`; a `both` client matches
    `buyer` and `supplier` (and `all`).
  - Search by name reuses the Phase 4 escaped-search approach (double-quote the
    term in the PostgREST filter so a comma/paren in a client name can't break
    the query).

Screen:
- Filter chips **All / Buyers / Suppliers**, plus a name search box.
- Directory stats: # buyers, # suppliers, # with active lots.
- Rows link to the profile. Owner sees a **"New client"** button.

### Client profile (`/clients/[id]`)

`src/lib/clients.ts` additions:
- `getClient(id): Promise<Client | null>` — full row.
- `getClientStats(id): Promise<{ lots: number; total_mt: number; imports: number; exports: number }>` — operational, **not** gated.
- `getClientLots(id): Promise<ClientLotRow[]>` — that client's lots, compact.
- `getClientInvoices(id): Promise<ClientInvoiceRow[]>` — like `LotInvoice` but
  **plus `lot_number`**: a client's invoices span multiple lots, so the profile
  must show which lot each belongs to (and link to it). RLS returns nothing for
  Management.

Screen:
- **Contact card**: name, type, country, contact name, email, phone, currency.
- **Volume stats** (operational, not gated): total lots, total MT, split
  import/export.
- **Lots list**: compact table → Lot Detail.
- **Invoices list**: financials-gated, identical to Lot Detail's rule — only
  rendered when `can(role, "view_financials")`, and RLS already returns zero
  rows for Management. UI hiding is cosmetic; the database is the mechanism.

### Client CRUD (Owner-only)

- `src/lib/schemas/client.ts` — Zod schema shared client/server: `name`
  (2–120), `type` (enum), `country`, `contact_name`, `email` (valid email or
  empty), `phone`, `currency` (3-letter). Optional text fields persist as NULL,
  not `""`. Unit-tested.
- `src/app/(app)/clients/actions.ts` — `saveClient`, `deleteClient` Server
  Actions. Both gate on `requireCapability("manage_users")` (the capability the
  matrix gives Owner alone, matching the `is_owner()` RLS on `clients`). RLS is
  the enforcement; the gate stops a misleading zero-rows "success".
- shadcn **Dialog** for create/edit; **controlled inputs** (React 19 resets an
  uncontrolled form after an action — carried lesson).
- **Delete guard**: count the client's lots and invoices; if either is nonzero,
  refuse with a reason, e.g. *"Acme Foods has 4 lots and 3 invoices. Reassign or
  remove those first."* A client with no history deletes cleanly.
- Every create/edit/delete writes an `audit_log` entry (Phase 9's verify needs
  every Phase 3–8 mutation logged).

## Files

| File | Responsibility |
|---|---|
| `src/lib/lots.ts` | Add `getPipeline(direction)` (modify) |
| `src/lib/clients.ts` | Directory, profile, stats, lots, gated invoices |
| `src/lib/schemas/client.ts` + `.test.ts` | Zod schema + unit tests |
| `src/app/(app)/imports/page.tsx` | Imports pipeline |
| `src/app/(app)/exports/page.tsx` | Exports pipeline |
| `src/components/pipeline-board.tsx` | Shared Kanban board (client where needed) |
| `src/app/(app)/clients/page.tsx` | Directory |
| `src/app/(app)/clients/client-filters.tsx` | URL-driven filter chips + search |
| `src/app/(app)/clients/[id]/page.tsx` | Profile |
| `src/app/(app)/clients/actions.ts` | `saveClient`, `deleteClient` |
| `src/app/(app)/clients/client-dialog.tsx` | Create/edit Dialog (client) |
| `src/app/(app)/clients/[id]/delete-client-button.tsx` | Delete with blocked-reason |
| `src/app/(app)/lots/new/page.tsx` | Read `?direction=` (modify) |

## Error handling

- Non-existent client id → `notFound()`.
- Zod failure → inline field errors; the Dialog stays open with values intact
  (controlled inputs).
- Delete blocked → explain what blocks it and how to proceed; never a raw FK error.
- Management reaching a client write path → refused by RLS. Note RLS does **not**
  error on `UPDATE`/`DELETE` (it matches zero rows), so the Server Actions gate
  on `requireCapability` to avoid a misleading success — carried Phase 3 lesson.
- Pipeline with no lots in a direction → columns render with count 0; a fully
  empty direction shows an empty state above the board.

## Verification

- **Pipeline counts match the lots table:** each column's count equals
  `select count(*) from lots where direction=… group by status`; the summary MT
  equals the direction's `sum(quantity_mt)`.
- **Management sees client profiles but no invoice amounts** — checked with a
  real Management session (data source), not by reading the JSX. Volume stats
  (MT, lot counts) remain visible; the Invoices section is absent.
- **Owner client CRUD** works and lands in the audit log; the hash chain still
  verifies.
- **Delete guard**: deleting a client with lots is blocked with the reason; a
  history-free client deletes.
- **Management sees no client CRUD controls**; a direct PostgREST write as
  Management is refused (zero rows affected / error), proven by a script.
- `npm test`, `tsc --noEmit`, `lint`, `build` all clean.

## Out of scope (deferred)

- Invoice CRUD and payments (Phase 6) — profiles only *read* invoices.
- Client trading-value / financial totals (Phase 6/8) — Phase 5 volume stats are
  operational (MT, counts) only.
- Realtime pipeline updates (Phase 7, optional).
- CSV export (Phase 10).
