# Phase 9 — Audit Log + Settings — Design Spec

**Date:** 2026-07-17
**Branch:** `phase-9-audit-settings`
**Status:** Approved (design), pending implementation plan

## Goal

An owner-only Audit Log screen (stat cards, user/action filters, chronological
SEQ+HASH entries, a "verify chain" action) and three Settings screens (Users &
Roles, Company Info, Preferences) whose stored values genuinely drive behavior.

## Scope (from PLAN.md Phase 9)

- Audit Log screen: stat cards, user/action filters, chronological entries with
  SEQ + HASH, plus a "verify chain" function.
- Settings: Users & Roles (add/deactivate user, role radio with capability
  descriptions — using shadcn Dialog so close actually works), Company Info
  (editable profile + admin-locked registration fields), Preferences (currency,
  date format, thresholds, alert toggles — and these values genuinely drive the
  alert logic).
- **Verify:** every mutation from Phases 3–8 appears in the log; chain
  verification passes; tamper test fails verification.

## Decided scope

- **Users & Roles = manage existing users only** — change role and
  activate/deactivate via a shadcn Dialog. No live account creation (Supabase
  admin API / email / temp passwords are out of scope for v1). This still fixes
  the demo's broken-modal bug and delivers real, enforced role/active changes.

## What already exists (build on, do not rebuild)

- **Audit hash-chain (Phase 1, migration 0007):** `audit_hash()` BEFORE INSERT
  trigger sets `prev_hash`/`hash` (sha256 over `prev_hash || seq || user_id ||
  action || entity_type || entity_id || details`). `verify_audit_chain()`
  returns the first bad `seq` or `null` if intact. `audit_log` is append-only
  (UPDATE/DELETE revoked for authenticated/anon) and owner-read
  (`audit_select using (is_owner())`). **No changes needed here.**
- `writeAudit(action, entityType, entityId, details)` — used by every mutating
  action in Phases 3–8, so the log is already populated. Actions in use:
  `create`, `update`, `delete`, `transition`, `resolve`, `flag`.
- `profiles` (id, full_name, role `app_role`, department): RLS select
  (self or owner), write (owner). `app_role` enum:
  `owner | management | warehouse | finance`.
- `companies_profile` singleton (name, address, port, fiscal_year_start,
  `registrations` jsonb): RLS select (all), write (owner).
- `settings` (key text PK, value jsonb): RLS select (all), write (owner).
  Seeded keys: `default_currency` ("USD"), `date_format` ("DD MMM YYYY"),
  `low_stock_threshold_pct` (80), `alerts`
  (`{overdue_invoices, over_capacity, missing_bl}`).
- `getSession` (`src/lib/auth.ts`) reads the profile; `requireCapability`;
  `can(role, capability)` with `view_audit` and `manage_users` (both owner-only).
- `getOpenExceptions` (`src/lib/exceptions.ts`, Phase 7) — the read path where
  the alert toggles will be applied.
- `getOccupancyThreshold` / the Phase 7 `sync_lot_exceptions` trigger already
  read `low_stock_threshold_pct`, so editing it changes behavior immediately.
- UI patterns: shadcn `Dialog` (`client-dialog.tsx`), controlled-input React-19
  reset workaround, URL-driven filters, server-action + `useActionState`,
  `writeAudit`, `BlockedScreen`, Tailwind stat cards/tables.

## Architecture

1. **Schema migration** — one column (`profiles.active`). The only DDL.
2. **Auth enforcement** — `getSession` treats a deactivated profile as no
   session.
3. **Audit data layer** (`src/lib/audit-log.ts`) — entries, stats, filter
   options, chain verification.
4. **Settings data + actions** — read/write `profiles`, `companies_profile`,
   `settings`; every write audited.
5. **Alert-toggle wiring** — `getOpenExceptions` filters disabled types.
6. **UI** — `/audit` and the three `/settings/*` screens.

## 1. Schema migration — `supabase/migrations/0016_audit_settings.sql`

```sql
-- Phase 9: deactivatable users. The audit chain (0007) already exists.
alter table profiles add column active boolean not null default true;
```

Deactivation is enforced in `getSession` (below); no RLS change — the owner
still writes `profiles`, and a deactivated user simply gets no session.

## 2. Auth enforcement — `src/lib/auth.ts`

`getSession` selects `active` and returns `null` when false:

```ts
const { data: profile } = await supabase
  .from("profiles")
  .select("id, full_name, role, department, active")
  .eq("id", user.id)
  .single();
if (!profile || profile.active === false) return null;
```

A deactivated user is redirected to `/login` by `requireUser` on the next
request — blocked by construction, not by UI hiding. `Profile` type gains
`active: boolean`.

## 3. Audit Log screen (`/audit`, gated `view_audit`)

### 3a. Data layer — `src/lib/audit-log.ts` (server-only)

```ts
export type AuditEntry = {
  seq: number; action: string; entity_type: string; entity_id: string | null;
  actor: string | null; created_at: string; hash: string;
};
export type AuditStats = { total: number; actors: number; byAction: { action: string; count: number }[] };

// listAuditEntries({ actor?, action? }, limit=100): AuditEntry[]
//   — audit_log rows (seq desc); actor names merged from a separate profiles read.
// getAuditStats(): AuditStats
// listActors(): { id, name }[]   // distinct users present in the log
// verifyChain(): { intact: boolean; badSeq: number | null }  // rpc verify_audit_chain
```

`audit_log.user_id` references `auth.users` (not `profiles`), so there is no
PostgREST FK to embed. The data layer reads the entries, then reads
`profiles (id, full_name)` for the distinct `user_id`s and merges the names in
JS (the pattern `clients.ts` uses for lot counts). Filtering by `actor`/`action`
is applied on the `audit_log` query directly.

### 3b. UI

- **Stat cards:** total entries, distinct actors, and the top actions.
- **Filters:** URL-driven `?actor=` and `?action=` (segmented/select), Phase-6
  pattern.
- **Table:** SEQ, action, entity (`entity_type` + short id), actor, timestamp,
  and a truncated `hash` in mono (full value in a `title`).
- **Verify chain:** a client island (`verify-chain-button.tsx`) →
  `verifyChainAction` server action → renders "Chain intact (N entries)" or
  "Tampering detected at seq N" in red.

## 4. Settings

### 4a. Users & Roles (`/settings/users`, `manage_users`)

- `listProfiles()` in `src/lib/users.ts` → all profiles (id, full_name, role,
  department, active).
- **Edit dialog** (`user-dialog.tsx`, shadcn Dialog): a **role radio** with a
  one-line capability description per role, and an **active** toggle.
- `saveUser` action (`settings/users/actions.ts`): `requireCapability
  ("manage_users")`, validate, update `profiles`, `writeAudit("update","user",
  id, {before, after})`. **Self-guard:** reject deactivating or changing the
  role of your own account (`id === session.user.id`) with a clear message, so an
  owner can't lock themselves out.

Role capability descriptions (from `permissions.ts`):
- **Owner** — full access, financials, audit, users & settings.
- **Management** — operations and lots; no financials.
- **Finance** — operations, financials, invoices.
- **Warehouse** — operations only.

### 4b. Company Info (`/settings/company`, `manage_users`)

- `getCompany()` → the singleton row.
- Form: name, address, port, fiscal_year_start (editable). `registrations`
  jsonb rendered **read-only** (admin-locked) — displayed as key/value rows, not
  form inputs.
- `saveCompany` action: update `companies_profile` (never touches
  `registrations`), `writeAudit("update","company", "profile", {before, after})`.

### 4c. Preferences (`/settings/preferences`, `manage_users`)

- `getPreferences()` → reads the four settings keys with sensible defaults.
- Form: `default_currency` (USD/EUR/GBP/AED select), `date_format` (a few
  presets), `low_stock_threshold_pct` (number 1–100), alert toggles
  (`overdue_invoices`, `over_capacity`, `missing_bl` checkboxes).
- `savePreferences` action: upsert each key into `settings` (value as jsonb),
  `writeAudit("update","settings", key, …)` per changed key (or one combined
  entry). Zod-validated (`preferencesSchema`).

## 5. Alert toggles genuinely drive behavior

`getOpenExceptions` reads the `alerts` setting and drops disabled types before
returning. Mapping:

```
overdue_invoices → overdue_invoice
over_capacity    → low_capacity
missing_bl       → missing_bl
```

Types without a toggle (`missing_payment_terms`, `weight_shortage`,
`compliance_block`) always show. Turning a toggle off in Preferences hides those
alerts on the Dashboard and Live Ops immediately. Combined with the threshold
(which already drives Phase 7 generation), this makes Preferences a live control
surface, not dead settings — the demo-gap fix.

## 6. Testing & verification

- **Vitest unit:** `preferencesSchema` (threshold 1–100 bounds, currency and
  date-format enums, toggle booleans); an `auditActionLabel` formatter
  (`create → "Created"`, `transition → "Status change"`, etc.).
- **Acceptance** `scripts/verify-audit.ts` (read-only except the tamper-and-
  restore, which is net-zero — the append-only log must not gain permanent test
  rows):
  1. **Phase 3–8 mutations are logged:** the log already contains the expected
     `action` values (`create`, `update`, `transition`, `resolve` at minimum) —
     asserted read-only, proving prior mutations were recorded. (The audit rows
     are written by the app's `writeAudit`, not a DB trigger, so the script does
     not insert rows it cannot delete.)
  2. **Chain intact:** `verify_audit_chain()` returns `null`.
  3. **Tamper test:** using the service-role runner (append-only is revoked for
     app users, not the service role), `update audit_log set details = …` on one
     row; assert `verify_audit_chain()` now returns that `seq`; then **restore
     the exact original `details`** and assert it returns `null` again.
  4. **RLS:** a Management session cannot update `profiles` or `settings`
     (0 rows / error), and cannot read `audit_log`.
- **Verify checklist (PLAN):** every Phase 3–8 mutation type already appears in
  the log (the acceptance lists distinct `action`s present); chain verification
  passes; the tamper test fails verification then is restored.
- **Static gates:** `tsc --noEmit`, `eslint`, `next build`, `vitest run`.

## Financial gating / safety

- `/audit` and all `/settings/*` are gated (`view_audit` / `manage_users` =
  owner); `audit_log` is owner-read by RLS, so even a direct query returns
  nothing to non-owners.
- The tamper test only ever mutates one `audit_log` row and restores it exactly
  within the same script; the script re-verifies `null` at the end. It never
  truncates or reseeds, and never touches `LOT-2026-00301`.
- Self-guard prevents an owner from deactivating/demoting themselves.

## Defaults (explicit, changeable)

- `registrations` is read-only (admin-locked) in v1.
- Alert toggles affect **display** of the three mapped exception types; the
  threshold affects **generation** (already wired). Other exception types always
  show.
- `savePreferences` writes one audit entry per changed key.

## Out of scope (later phases / backlog)

- Live account creation / invitations (Supabase admin API, email) — deferred.
- Editing `registrations` fields (kept admin-locked).
- CSV export, empty/loading polish (Phase 10).
- Threading `default_currency` / `date_format` through every screen's formatting
  (v1 persists them and uses them where low-cost; a global formatter is Phase 10
  polish).
