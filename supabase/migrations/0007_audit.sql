create or replace function public.audit_hash()
returns trigger
language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  p text;
begin
  -- serialize appends so concurrent inserts can't read the same prev_hash
  perform pg_advisory_xact_lock(hashtext('audit_log_chain'));
  select hash into p from public.audit_log order by seq desc limit 1;
  new.prev_hash := p;
  new.hash := encode(digest(
    coalesce(p,'') || new.seq::text || coalesce(new.user_id::text,'') ||
    new.action || new.entity_type || coalesce(new.entity_id,'') || new.details::text,
    'sha256'), 'hex');
  return new;
end;
$$;

create trigger audit_hash_trg
  before insert on public.audit_log
  for each row execute function public.audit_hash();

create or replace function public.verify_audit_chain()
returns bigint
language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  r record;
  p text := null;
  h text;
begin
  for r in select * from public.audit_log order by seq loop
    h := encode(digest(
      coalesce(p,'') || r.seq::text || coalesce(r.user_id::text,'') ||
      r.action || r.entity_type || coalesce(r.entity_id,'') || r.details::text,
      'sha256'), 'hex');
    if h <> r.hash or coalesce(r.prev_hash,'') <> coalesce(p,'') then
      return r.seq;
    end if;
    p := r.hash;
  end loop;
  return null;
end;
$$;

revoke all on function public.verify_audit_chain() from public;
grant execute on function public.verify_audit_chain() to authenticated;
