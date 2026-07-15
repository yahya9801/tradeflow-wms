-- A "stay": one row per period a lot occupied a shed.
-- removed_at IS NULL  → the lot is still in that shed.
create table lot_movements (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references lots(id) on delete cascade,
  shed_id uuid not null references sheds(id),   -- no cascade → shed delete blocks
  placed_at timestamptz not null default now(),
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint stay_interval_valid check (removed_at is null or removed_at >= placed_at)
);

create index on lot_movements (shed_id);
create index on lot_movements (lot_id);

-- A lot can only be in one shed at a time.
create unique index one_open_stay_per_lot on lot_movements (lot_id) where removed_at is null;

alter table lot_movements enable row level security;
create policy lm_select on lot_movements for select to authenticated using (true);
create policy lm_write on lot_movements for all to authenticated
  using (current_app_role() in ('owner','management'))
  with check (current_app_role() in ('owner','management'));

-- Keeps history in sync with lots.shed_id / lots.status, which stay authoritative.
create or replace function public.sync_lot_movement()
returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- Leaving storage, or moving shed → close the open stay.
  if tg_op = 'UPDATE' then
    if (new.status is distinct from 'stored')
       or (new.shed_id is distinct from old.shed_id) then
      update lot_movements
         set removed_at = now()
       where lot_id = new.id and removed_at is null;
    end if;
  end if;

  -- Stored in a shed with no open stay → open one.
  if new.status = 'stored' and new.shed_id is not null then
    if not exists (
      select 1 from lot_movements where lot_id = new.id and removed_at is null
    ) then
      insert into lot_movements (lot_id, shed_id) values (new.id, new.shed_id);
    end if;
  end if;

  return new;
end;
$$;

create trigger lots_sync_movement
  after insert or update of status, shed_id on lots
  for each row execute function public.sync_lot_movement();

-- Warehouse rollup. Occupancy is measured against SHED capacity (goods only
-- live in sheds); rated capacity is context, and rated - shed_capacity is
-- unallocated space.
create view public.warehouse_occupancy with (security_invoker = on) as
select
  w.id                            as warehouse_id,
  w.name,
  w.capacity_mt                   as rated_capacity_mt,
  coalesce(sum(s.capacity_mt), 0) as shed_capacity_mt,
  coalesce(sum(so.stored_mt), 0)  as stored_mt,
  case when coalesce(sum(s.capacity_mt), 0) > 0
    then round(coalesce(sum(so.stored_mt), 0) / sum(s.capacity_mt) * 100, 1)
    else 0 end                    as occupancy_pct,
  count(s.id)                     as shed_count
from public.warehouses w
left join public.sheds s on s.warehouse_id = w.id
left join public.shed_occupancy so on so.shed_id = s.id
group by w.id, w.name, w.capacity_mt;

grant select on public.warehouse_occupancy to authenticated, anon;
