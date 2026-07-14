-- Phase 1 RLS acceptance checks — manual reference for the Supabase SQL editor.
-- The AUTHORITATIVE automated version is `scripts/verify-rls.ts` (logs in as the
-- real seeded users over the anon key). This file documents the same checks for
-- ad-hoc inspection.
--
-- First, grab the two user UUIDs to paste into the claims below:
--   select id, email from auth.users where email in
--     ('owner@tradeflow.example','management@tradeflow.example');

-- ── Management: no financial data ───────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"<MANAGEMENT_USER_UUID>","role":"authenticated"}';

select count(*) as management_invoice_rows from invoices;              -- expect 0
select market_price_per_mt from commodities_view limit 1;              -- expect NULL
select market_value from lots_view limit 1;                           -- expect NULL
select count(*) as management_audit_rows from audit_log;               -- expect 0
reset role;

-- ── Owner: full financial visibility ────────────────────────────────────
set local role authenticated;
set local request.jwt.claims to '{"sub":"<OWNER_USER_UUID>","role":"authenticated"}';

select count(*) as owner_invoice_rows from invoices;                   -- expect > 0
select market_price_per_mt from commodities_view
  where market_price_per_mt is not null limit 1;                       -- expect a value
reset role;

-- ── Audit immutability (as authenticated) ───────────────────────────────
-- Runs against the REVOKE + RLS; expect: ERROR permission denied.
set local role authenticated;
set local request.jwt.claims to '{"sub":"<OWNER_USER_UUID>","role":"authenticated"}';
delete from audit_log where seq = (select min(seq) from audit_log);    -- expect ERROR
reset role;

-- ── Chain integrity ─────────────────────────────────────────────────────
select verify_audit_chain();  -- expect NULL (intact)
