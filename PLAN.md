## 4. Phased Vibe-Coding Plan

Each phase is sized for one focused AI-coding session (roughly one context window), has a clear deliverable, and ends with a **verify checklist**. Do them in order — each builds on the last. Keep a `PROJECT.md` in the repo root containing the data model + role matrix from §3, and paste/reference it at the start of every session so the AI never loses the domain.

### Phase 0 — Scaffold & Foundations *(½ day)*
- `create-next-app` (TS, App Router, Tailwind), install shadcn/ui, set up Supabase project, env vars, GitHub repo + Actions (lint/typecheck).
- App shell: sidebar with module groups, mobile bottom tab bar, top-right user menu, empty routes for every screen in §1.
- **Verify:** deploys to Vercel, all routes render placeholder pages, nav works on mobile + desktop.

### Phase 1 — Database Schema + RLS + Seed Data *(1 day — the most important phase)*
- Write all §3 tables as Supabase migrations. Enable RLS on every table; write policies per the capability matrix. Audit table: insert-only trigger + hash chaining.
- Seed script: 2 warehouses with 3–4 sheds each, ~10 commodities, ~30 suppliers, ~50 buyers, ~100 lots across all statuses, invoices (AR **and AP**), a few open exceptions. Complete data — no "·"/"—" blanks like the demo.
- **Verify (critical):** with a Management-role JWT in the SQL editor, `select amount from invoices` returns nothing/no financial columns; audit rows cannot be updated or deleted.

### Phase 2 — Auth + RBAC Plumbing *(½–1 day)*
- Supabase Auth (email/password), middleware-protected routes, `profiles` row on signup, server-side session (fixes the demo's reload bug by construction).
- `usePermissions()` / server `can(user, capability)` helper — the *only* way the app ever asks "can this user see money?"
- Blocked-screen component ("Owner access required") for unauthorized direct navigation.
- Optional dev-only "switch user" dropdown (like the demo's, but backed by real sessions).
- **Verify:** log in as Management, hard-reload on /accounts → still blocked. Typed URLs cannot escalate.

### Phase 3 — Warehouses & Sheds *(1 day)*
- Warehouses list (capacity cards, occupancy bars), facility detail with per-shed breakdown, **clickable historical-lot list per shed** (demo gap fix), warehouse/shed CRUD (Owner).
- Occupancy math derived from stored lots (a SQL view is ideal).
- **Verify:** capacities sum correctly; history list filters correctly.

### Phase 4 — Lots Core (the heart) *(2 days)*
- Lots list: search, direction filter, status tabs, row → detail.
- New/Edit Lot form: Import/Export toggle swapping field sets, dependent warehouse → shed dropdown, auto lot-number, auto bags, Zod validation (require B/L for in-transit imports, payment terms for exports).
- Lot Detail: header + **status stepper with permitted transitions as actions**, shipment/storage/counterparty/commodity cards, related invoices (financials permission-gated), **open exceptions shown here with resolve actions** (demo gap fix).
- Every create/edit/transition writes audit entries.
- **Verify:** full lifecycle Pending→Delivered works; shed capacity updates on store/dispatch; Management sees the lot but no amounts anywhere on this page.

### Phase 5 — Trade Module *(1 day)*
- Imports view + Exports view (summary stats, status-bucket grouping, cards, "New Import/Export Lot" pre-setting the form direction).
- Clients directory (filter buyers/suppliers, stats) + Client profile (contact, volume, lots list, invoices list — invoices gated) + client CRUD.
- **Verify:** counts match lots table; Management sees client profiles without invoice amounts.

### Phase 6 — Finance: AR/AP *(1–2 days)*
- Invoice CRUD linked to lots/clients; payments (partial → status partial/paid).
- Accounts screen: Overview (net position, AR/AP outstanding, **aging buckets**, currency exposure), Receivable tab, **Payable tab actually implemented** (demo bug fix), overdue auto-badging, status filters, **click-through from invoice → lot/client** (demo gap fix).
- Owner/Finance only end-to-end.
- **Verify:** aging buckets sum to AR outstanding; partial payment math correct; Management gets blocked screen.

### Phase 7 — Exception Engine + Dashboard + Live Ops *(1–2 days)*
- Exception generation (DB triggers or on-write checks) for all §3 rules; resolve flow writes audit entries.
- Executive Dashboard: net position (gated), pipeline MT/FCL, storage gauge, cash-flow breakdown (gated), Action Center (links to lots where the exception is now actually visible), quick actions, recent activity, per-warehouse capacity.
- Live Ops: stat cards, pipeline by carrier, severity-tagged alert list, TanStack Table grid grouped by status bucket with buyer filter; financial columns simply absent for non-financial roles (no "Redacted" placeholders needed — cleaner than the demo).
- Optional: Supabase Realtime so the grid updates live.
- **Verify:** create a lot In Transit without B/L → exception appears on Dashboard AND its Lot Detail; resolve it → disappears everywhere.

### Phase 8 — Reporting: Balance Sheet / P&L *(1 day)*
- Date-range selector (This Month / 90 Days / All Time), executive summary (revenue, cost, gross profit, margin), AR/AP flow (collected, pipeline, liquidation %), commodity performance table (per-commodity revenue/cost/profit/margin, negative in red), currency exposure, ledger activity feed.
- Build on SQL views — keep aggregation in the database, not JS.
- **Verify:** hand-check one commodity's margin against raw invoices.

### Phase 9 — Audit Log + Settings *(1 day)*
- Audit Log screen: stat cards, user/action filters, chronological entries with SEQ + HASH, plus a "verify chain" function.
- Settings: Users & Roles (add/deactivate user, role radio with capability descriptions — using shadcn Dialog so close actually works), Company Info (editable profile + admin-locked registration fields), Preferences (currency, date format, thresholds, alert toggles — and these values genuinely drive the alert logic).
- **Verify:** every mutation from Phases 3–8 appears in the log; chain verification passes; tamper test fails verification.

### Phase 10 — Polish, QA & Deploy *(1–2 days)*
- Empty/loading/error states everywhere, mobile pass on warehouse-floor screens (Lots, New Lot, warehouse detail), toasts, CSV export for lots/invoices/reports.
- Playwright smoke: login → create lot → transition to Stored → raise invoice → pay → verify audit. Vitest on bags math, aging buckets, margin calc, permission helper.
- Security pass: confirm RLS on all tables, rate limiting on auth, security headers in `next.config`, no secrets in client bundles.
- Production Supabase project + Vercel env, seed real reference data.

**Total: ~10–13 focused days.** (The proposal's 4-week timeline for a team of 5 is consistent with this for a solo vibe-coder.)

---

## 5. Vibe-Coding Ground Rules (how to keep the AI on the rails)

1. **`PROJECT.md` is the constitution.** Keep §1–§3 of this document in the repo; start every session by having the AI read it. Update it whenever a decision changes.
2. **One phase per session.** Don't let a session bleed into the next phase; commit and stop at each verify checklist.
3. **Schema is sacred.** After Phase 1, schema changes go through explicit migrations you review — never let a coding session "quietly" alter tables to make its feature easier.
4. **RLS before UI.** Any new data surface gets its policy written and tested in SQL first, UI second. This is the single discipline that prevents the demo's entire security bug class.
5. **Commit per feature, deploy per phase.** Vercel preview deployments give you a clickable checkpoint after every phase.
6. **Test the money and the walls.** You don't need high coverage — but bags/aging/margin math and the permission helper get unit tests, and one Playwright run proves a Management user can't reach financials by URL.
7. **Ask the AI to fix forward, not rewrite.** When something breaks, paste the error + the relevant file; don't regenerate whole modules.

---

## 6. Deferred / v2 Backlog (explicitly out of scope for v1)

- Additional role tiers beyond Owner/Management (Warehouse, Finance, Sales scoping — schema already supports it).
- Multi-entity/subsidiary consolidation (add `entity_id` to lots/invoices when needed — noted in the original proposal but absent from the demo).
- Document generation (invoices/delivery notes as PDFs), barcode/QR scanning, weighbridge/IoT integration.
- Historical data migration from legacy systems.
- Notifications (email/WhatsApp alerts for exceptions and overdue invoices).
- Multi-currency FX revaluation (v1 records currency per invoice; conversion/exposure math stays simple).
