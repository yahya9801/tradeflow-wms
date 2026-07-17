select 'report_pnl_summary fn' as check,
  to_regprocedure('public.report_pnl_summary(date,date)') is not null as ok
union all
select 'report_by_commodity fn',
  to_regprocedure('public.report_by_commodity(date,date)') is not null
union all
select 'summary returns a row',
  (select count(*) from public.report_pnl_summary(null, null)) = 1;
