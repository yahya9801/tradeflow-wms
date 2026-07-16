-- Physical rules for a lot. These live in the database because Management can
-- UPDATE lots through RLS, so an app-only check could be skipped with a direct
-- PostgREST call. The UI offers only legal moves on top of this.
create or replace function public.enforce_lot_rules()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  order_of constant lot_status[] := array[
    'pending','in_transit','received','stored','dispatched','delivered'
  ]::lot_status[];
  old_idx int;
  new_idx int;
  delta int;
  free_mt numeric;
  shed_name text;
  shed_cap numeric;
begin
  -- Seed / migration / service_role context: already bypasses RLS, so it is
  -- not subject to app rules. Without this, reseeding cannot run.
  if auth.uid() is null then
    return new;
  end if;

  -- 1. Transition legality: next step for anyone, one step back for the Owner.
  if new.status is distinct from old.status then
    old_idx := array_position(order_of, old.status);
    new_idx := array_position(order_of, new.status);
    delta := new_idx - old_idx;

    if delta = 1 then
      null;                                   -- forward one: always allowed
    elsif delta = -1 and is_owner() then
      null;                                   -- owner correction
    else
      raise exception '% cannot move from % to %', new.lot_number, old.status, new.status
        using errcode = 'check_violation';
    end if;
  end if;

  -- 2. Capacity: a shed cannot hold more than it physically can.
  if new.status = 'stored' and new.shed_id is not null then
    select s.name, s.capacity_mt into shed_name, shed_cap
      from sheds s where s.id = new.shed_id;

    select shed_cap - coalesce(sum(l.quantity_mt), 0)
      into free_mt
      from lots l
     where l.shed_id = new.shed_id
       and l.status = 'stored'
       and l.id <> new.id;                    -- exclude this lot when re-saving

    if free_mt < new.quantity_mt then
      raise exception '% has % MT free; % is % MT',
        shed_name, trim(to_char(free_mt, 'FM999999990.###')),
        new.lot_number, trim(to_char(new.quantity_mt, 'FM999999990.###'))
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

create trigger lots_enforce_rules
  before update on public.lots
  for each row execute function public.enforce_lot_rules();
