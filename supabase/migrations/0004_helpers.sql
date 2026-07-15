create or replace function public.current_app_role()
returns app_role
language sql stable security definer set search_path = public, pg_temp as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.can_view_financials()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select role in ('owner','finance') from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.is_owner()
returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select role = 'owner' from public.profiles where id = auth.uid()), false);
$$;

revoke all on function public.current_app_role(), public.can_view_financials(), public.is_owner() from public;
grant execute on function public.current_app_role(), public.can_view_financials(), public.is_owner() to authenticated, anon;
