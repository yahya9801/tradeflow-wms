-- Run in the Supabase SQL editor after applying 0013_finance.sql.
select 'payments table' as check, to_regclass('public.payments') is not null as ok
union all
select 'can_manage_invoices fn', to_regprocedure('public.can_manage_invoices()') is not null
union all
select 'payments_sync trigger',
  exists(select 1 from pg_trigger where tgname = 'payments_sync')
union all
select 'invoices_resync_status trigger',
  exists(select 1 from pg_trigger where tgname = 'invoices_resync_status')
union all
select 'invoice_no default set',
  (select column_default like 'INV-%' or column_default like '%invoice_number_seq%'
     from information_schema.columns
    where table_name = 'invoices' and column_name = 'invoice_no');
