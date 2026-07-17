select 'profiles.active column' as check,
  exists(select 1 from information_schema.columns
          where table_name='profiles' and column_name='active') as ok
union all
select 'verify_audit_chain intact',
  (select public.verify_audit_chain()) is null;
