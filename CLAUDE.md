# Warehouse Management System (WMS) — Master Build Plan

A de-branded rebuild plan derived from the SIMS demo documentation and vendor proposal. All references to the original vendor, client, and demo company have been removed. Working name: **TradeFlow WMS** (rename freely — it's a placeholder).

---

## 1. What We Are Building (De-branded Product Definition)

A **commodity trade & warehouse management platform** for an import/export business. It is *not* a retail SKU system — the core entity is a **Lot** (a shipment of a commodity, e.g. 500 MT of rice) that moves through a lifecycle:

```
Pending → In Transit → Received → Stored → Dispatched → Delivered
```

Around that core, the system provides:

1. **Multi-warehouse storage tracking** — warehouses → sheds/bays, capacity in MT, occupancy %, low-stock/over-capacity alerts (80% threshold, configurable).
2. **Import & Export operations views** — inbound (origin → port → warehouse) and outbound (warehouse → destination) pipelines, grouped by status.
3. **Trade directory** — suppliers and buyers, each with contact info, currency, trading history, and linked invoices.
4. **Finance (AR/AP)** — invoices linked to lots, aging analysis, currency exposure, P&L/balance-sheet style reporting, overdue detection.
5. **Exception engine ("Action Center")** — auto-flagged issues: weight-shortage claims, missing B/L numbers, missing payment terms, compliance blocks, each with severity (CRITICAL / WARNING / NOTICE) — and, unlike the demo, each flag must be **resolvable** on the lot it references.
6. **Role-based access control** — role tiers with real, server-enforced permissions (see §3).
7. **Audit log** — append-only activity trail (who did what, when, old → new values), hash-chained per record.
8. **Settings** — users & roles, company profile (used on invoices/delivery docs), preferences (currency, date format, alert toggles).

### Screens inventory (from the demo, kept, de-branded)

| Module | Screens |
|---|---|
| Overview | Executive Dashboard, Live Ops (command center grid) |
| Warehouse | Warehouses & Sheds list, Facility detail, Lots list, New/Edit Lot form, Lot detail |
| Trade | Imports view, Exports view, Clients directory, Client profile |
| Finance | Accounts (AR/AP tabs + aging), Balance Sheet / P&L, Audit Log |
| System | Settings: Users & Roles, Company Info, Preferences |

### Demo bugs we must NOT replicate (fix list)

- ❌ Session/role stored in memory only → resets to Owner on page reload / typed URL. **Fix:** real server-side auth (Supabase Auth), role enforced in DB via RLS — not just hidden in the UI.
- ❌ Accounts → Payable tab empty while Overview claims 332 payables. **Fix:** AP fully implemented, same treatment as AR.
- ❌ Inconsistent redaction — amounts hidden on Live Ops grid but visible on Lot Detail / Client Profile for Management role. **Fix:** financial visibility is a **single permission** checked everywhere (and enforced at the API/RLS layer, so it can't be inconsistent).
- ❌ Action Center flags link to lots that show no claim/warning record. **Fix:** exceptions are first-class DB records attached to lots, visible and resolvable on Lot Detail.
- ❌ Warehouse "historical lots" note is dead text. **Fix:** clickable, filtered historical lot list per shed.
- ❌ Add User modal "×" doesn't close. **Fix:** use a proper dialog component (shadcn/ui Dialog).
- ❌ No Edit/status-change controls on Lot Detail. **Fix:** status transitions + edit permitted by role, all changes audit-logged.

---

## 2. Technology Stack (Recommendation)

The proposal's stack is genuinely a good fit for vibe-coding this — it's the stack AI tools know best and it minimizes infrastructure work. Keep it, with a few upgrades:

| Layer | Choice | Why |
|---|---|---|
| Framework | **Next.js 15 (App Router) + TypeScript** | Proposal said Next 14; use current stable. Server Components + Server Actions = no separate API server needed. AI coding tools have the deepest training on this stack. |
| Styling / UI | **Tailwind CSS + shadcn/ui** | shadcn gives you accessible Dialog/Table/Tabs/Dropdown components for free — directly fixes the broken-modal class of bugs and makes dashboards fast to build. |
| Database + Auth | **Supabase (Postgres + Auth + RLS + Realtime)** | Row-Level Security enforces role permissions *in the database* — the correct fix for the demo's fake client-side RBAC. Realtime powers the Live Ops screen. Free tier is enough for dev. |
| Data fetching | Server Components + **TanStack Query** for client-side interactivity | Simple and standard. |
| Validation | **Zod** (shared schemas client + server) | One source of truth for form validation and API input sanitisation. |
| Charts | **Recharts** | Dashboard gauges, aging buckets, capacity bars. |
| Tables | **TanStack Table** | Live Ops grid: grouping, sorting, filtering. |
| Hosting | **Vercel** (app) + Supabase cloud (DB) | Zero-ops, preview deployments per branch. |
| CI | GitHub Actions (typecheck + lint + test on every push) | Cheap insurance while vibe-coding. |
| Testing | Vitest (unit for finance/status logic) + Playwright (a few E2E smoke flows) | Keep it light but cover money math and RBAC. |

**Deliberate exclusions for v1:** no separate backend service, no microservices, no Redis, no Docker/K8s. Supabase + Next.js covers everything. Migration off Supabase later is possible since it's plain Postgres.

---

## 3. Data Model (build this first — everything hangs off it)

### Core tables

```
companies_profile   — single-row company info for invoices (name, address, port, fiscal year, registrations)
profiles            — extends auth.users: full_name, role, department
warehouses          — name, address, capacity_mt
sheds               — warehouse_id, name, capacity_mt
commodities         — name, hs_code, category, market_price_per_mt, bag_weight_kg
clients             — name, type ENUM(buyer|supplier|both), country, contact, email, phone, currency
lots                — lot_number (auto), direction ENUM(import|export), commodity_id, client_id,
                      quantity_mt, bags (computed), warehouse_id, shed_id,
                      status ENUM(pending|in_transit|received|stored|dispatched|delivered),
                      origin_country / destination_country, vessel_name, bl_number,
                      export_ref, payment_terms ENUM(LC|TT|CAD|DA), eta, arrival_date,
                      dispatch_date, notes, created_by, timestamps
invoices            — invoice_no, lot_id, client_id, type ENUM(receivable|payable),
                      status ENUM(pending|partial|paid), currency, amount, amount_paid,
                      due_date, description
exceptions          — lot_id, type ENUM(weight_shortage|missing_bl|missing_payment_terms|compliance_block|overdue_invoice|low_capacity),
                      severity ENUM(critical|warning|notice), description,
                      status ENUM(open|resolved), resolved_by, resolved_at
audit_log           — seq (bigserial), user_id, action, entity_type, entity_id,
                      details JSONB (old/new values), hash, prev_hash, created_at
                      (INSERT-only: REVOKE UPDATE/DELETE; hash = sha256(prev_hash || row))
settings            — key/value: default_currency, date_format, low_stock_threshold_pct,
                      alert toggles
```

### Roles & permissions (server-enforced, one source of truth)

Keep the demo's two tiers but define them as **capabilities**, not screen lists, so redaction can never be inconsistent:

| Capability | Owner | Management | (Future: Warehouse, Finance) |
|---|---|---|---|
| view_operations (lots, warehouses, clients, import/export) | ✅ | ✅ | scoped |
| create/edit lots, change status | ✅ | ✅ | Warehouse: receive/dispatch only |
| **view_financials** (amounts, invoices, net position, prices) | ✅ | ❌ | Finance: ✅ |
| manage invoices | ✅ | ❌ | Finance: ✅ |
| view audit log | ✅ | ❌ | ❌ |
| manage users & settings | ✅ | ❌ | ❌ |

Implementation rule: **every** amount/price/invoice the UI renders comes from a query path that RLS already filtered — Management users simply never receive financial columns from the API. UI hiding is cosmetic on top, never the mechanism. This single rule fixes the demo's entire redaction-inconsistency bug class.

### Key business rules to encode

- Bags = quantity_mt × 1000 / commodity.bag_weight_kg (auto-computed).
- Status transitions are forward-only along the lifecycle (with an Owner-only override), and each transition writes an audit entry.
- Storing a lot consumes shed capacity; dispatch/delivery releases it; occupancy > threshold (default 80%) auto-creates a `low_capacity` exception.
- Invoice past due_date and not paid → auto `overdue` flag (computed, or nightly job).
- Lot marked In Transit with null bl_number → auto `missing_bl` exception; export lot with null payment_terms → `missing_payment_terms` exception. Resolving = filling the field or explicitly resolving with a note.

---