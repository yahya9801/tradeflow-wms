select 'one-open index' as check,
  exists(select 1 from pg_indexes where indexname = 'exceptions_one_open_per_type') as ok
union all
select 'lots_sync_exceptions trigger',
  exists(select 1 from pg_trigger where tgname = 'lots_sync_exceptions')
union all
select 'refresh_overdue_exceptions fn',
  to_regprocedure('public.refresh_overdue_exceptions()') is not null
union all
select 'lots in realtime publication',
  exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='lots')
union all
select 'exceptions in realtime publication',
  exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and tablename='exceptions');
