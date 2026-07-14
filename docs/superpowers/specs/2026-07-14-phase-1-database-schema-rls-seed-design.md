# Phase 1 — Database Schema + RLS + Seed Data (Design)

**Date:** 2026-07-14
**Project:** TradeFlow WMS
**Phase:** 1 of 10 (see `PLAN.md`) — "the most important phase"
**Status:** Approved

## Goal

Stand up the complete Postgres data model from `CLAUDE.md` §3 on the Supabase
cloud project, with Row-Level Security enforcing the capability matrix **in the
database** (not just the UI), an append-only hash-chained audit log, and a full
seed of realistic business data with no blank fields.

This phase produces **no UI**. The "production-like UI" requirement applies from
Phase 2 onward and will be driven through the `frontend-design` skill.

## Context / constraints

- **No Docker** on this machine → no local Supabase stack. Migrations target the
  **cloud** project (`tepcjahgmggajenimltn`) directly via `supabase db push`.
- Supabase CLI available via `npx supabase` (v2.109).
- `.env.local` holds the project URL + publishable (anon) key. The seed script
  additionally needs the **service_role/secret key** (`SUPABASE_SERVICE_ROLE_KEY`),
  provided by the user; git-ignored.

## Decisions (approved)

1. **Migration workflow:** Supabase CLI with versioned SQL migrations in
   `supabase/migrations/`, applied to cloud via `supabase db push`. User runs
   `supabase login` + `supabase link` (DB password) once.
2. **Financial enforcement:** RLS row-policies for whole-row financial tables
   (`invoices`); `security_invoker` masking **views** for financial columns
   embedded in operational rows (`commodities.market_price_per_mt`). A
   `SECURITY DEFINER` `can_view_financials()` helper reads `profiles.role`.
3. **Test users:** seeded now via a TS admin script (service_role) so the
   critical RLS verify can run this phase.

## Migration structure

Ordered SQL files in `supabase/migrations/`:

| File | Contents |
|---|---|
| `0001_extensions.sql` | `pgcrypto` (sha256 for audit), `citext` (emails) |
| `0002_enums.sql` | `app_role`, `lot_direction`, `lot_status`, `client_type`, `invoice_type`, `invoice_status`, `payment_terms`, `exception_type`, `exception_severity`, `exception_status` |
| `0003_tables.sql` | All §3 tables + FKs + constraints |
| `0004_helpers.sql` | `current_app_role()`, `can_view_financials()`, `is_owner()` — `SECURITY DEFINER`, read `profiles.role` |
| `0005_rls.sql` | Enable RLS on every table + policies |
| `0006_financial_views.sql` | `security_invoker` masking views (`commodities_view`, `lots_view`) |
| `0007_audit.sql` | Hash-chain trigger + `REVOKE UPDATE/DELETE` + `verify_audit_chain()` |
| `0008_occupancy.sql` | `shed_occupancy` view (stored-lot MT ÷ capacity) |

## Schema specifics / decisions

- **`bags`** is computed in `lots_view`, **not** a stored generated column — a
  Postgres generated column cannot reference another table, and `bag_weight_kg`
  lives on `commodities`. Formula: `round(quantity_mt * 1000 / bag_weight_kg)`.
- **Forward-only status transitions** enforced by a `BEFORE UPDATE` trigger on
  `lots`, with an Owner-only override; each transition writes an audit entry.
- Types: money `numeric(14,2)`, `quantity_mt` `numeric(12,3)`.
- `profiles.role` is `app_role`; `owner`/`management` used now, `warehouse`/
  `finance` reserved for v2 (schema already supports them).
- `lot_number` auto-generated (sequence-backed, e.g. `LOT-2026-00001`).
- `audit_log.seq` is `bigserial`; `details` is `JSONB` (old/new values).

## Capability & RLS model

Single source of truth — helpers read `profiles.role`:

- `can_view_financials()` → `role IN ('owner','finance')`
- `is_owner()` → `role = 'owner'`
- `current_app_role()` → the caller's role

Policies:

- **Operational** (`warehouses`, `sheds`, `commodities`, `clients`, `lots`,
  `exceptions`): authenticated `SELECT`; `INSERT/UPDATE` gated — `lots` by
  owner+management, `warehouses`/`sheds`/`commodities`/`clients` by owner.
- **invoices**: `SELECT/INSERT/UPDATE` all `USING (can_view_financials())` →
  Management receives **zero invoice rows**, enforced in the DB.
- **audit_log**: `SELECT` owner-only; `INSERT` allowed (authenticated);
  `UPDATE`/`DELETE` revoked entirely (no policy + `REVOKE`).
- **settings / companies_profile**: read authenticated; write owner-only.
- **profiles**: read own + owner reads all; role changes owner-only.

## Financial masking for embedded columns

```sql
create view commodities_view with (security_invoker = on) as
select id, name, hs_code, category, bag_weight_kg,
       case when can_view_financials() then market_price_per_mt end
         as market_price_per_mt
from commodities;
```

Same pattern for `lots_view` (exposes `bags`, and masks any derived lot value).
Base-table RLS still applies underneath because the views are
`security_invoker = on`. The app reads through these views wherever a financial
column could otherwise leak.

## Audit hash chaining

`BEFORE INSERT` trigger on `audit_log`:

```
prev_hash := (select hash from audit_log order by seq desc limit 1);
hash := encode(digest(
  coalesce(prev_hash,'') || seq::text || coalesce(user_id::text,'') ||
  action || entity_type || coalesce(entity_id::text,'') || details::text,
  'sha256'), 'hex');
```

`REVOKE UPDATE, DELETE ON audit_log FROM authenticated, anon;`
`verify_audit_chain()` recomputes every row's hash in `seq` order and returns the
first `seq` where the chain breaks (NULL = intact). Surfaced in Phase 9; the
function exists now for the verify step.

## Seed data (`scripts/seed.ts`, run via `tsx`, service_role)

Idempotent script (clears + reseeds business tables; upserts the two users):

1. Create `owner@tradeflow.example` + `management@tradeflow.example` auth users
   (admin API) + matching `profiles` rows with roles.
2. Bulk-insert with the service_role client (bypasses RLS):
   - 2 warehouses × 3–4 sheds (capacities in MT)
   - ~10 curated commodities (rice, wheat, sugar, …) with HS codes, bag weights,
     market prices
   - ~30 suppliers + ~50 buyers (faker for names/countries/contacts; currency set)
   - ~100 lots spanning **every** status, both directions, with vessel/BL/eta/etc.
   - invoices **AR + AP**, mix of pending/partial/paid + some overdue
   - a handful of open exceptions (weight_shortage, missing_bl, …)
3. No blank/`—` fields anywhere (explicit fix vs the demo).

`created_by` on lots/invoices references the owner user id.

## Verification

- `supabase db push` succeeds; `select` on `pg_tables` / `pg_policies` confirms
  RLS enabled + policies present on every table.
- **Critical RLS test** — SQL snippet setting
  `request.jwt.claims`/`role authenticated` to the management user:
  - `select amount from invoices` → **0 rows**
  - `select market_price_per_mt from commodities_view` → **NULL**
  - as owner → both visible.
- `update`/`delete` on `audit_log` → permission denied.
- `verify_audit_chain()` → intact (NULL).
- Count sanity: lots-per-status distribution; AR total vs AP total both > 0.

## Prerequisites the user provides at execution time

- `npx supabase login` + `npx supabase link --project-ref tepcjahgmggajenimltn`
  (DB password) — for `db push`.
- `SUPABASE_SERVICE_ROLE_KEY` in `.env.local` — for the seed script only.

## Out of scope for Phase 1 (deferred per PLAN.md)

- Auth UI / middleware / session (Phase 2).
- Exception **auto-generation** triggers (Phase 7) — Phase 1 seeds a few
  exception rows and defines the table; automatic creation rules come later.
- Any application UI.
