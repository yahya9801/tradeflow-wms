-- Phase 7: exception generation engine. Idempotency index, generation trigger
-- on lots, overdue refresh function, realtime publication.

-- 1a. At most one open exception per (lot, type).
create unique index exceptions_one_open_per_type
  on exceptions (lot_id, type) where status = 'open';

-- 1b. Open/resolve one exception type for a lot (idempotent).
create or replace function public.gen_lot_exception(
  p_lot uuid, p_type exception_type, p_sev exception_severity,
  p_active boolean, p_desc text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_active then
    insert into exceptions (lot_id, type, severity, description)
    values (p_lot, p_type, p_sev, p_desc)
    on conflict (lot_id, type) where status = 'open' do nothing;
  else
    update exceptions
       set status = 'resolved', resolved_at = now(),
           note = coalesce(note, 'Auto-resolved: condition cleared')
     where lot_id = p_lot and type = p_type and status = 'open';
  end if;
end $$;

create or replace function public.sync_lot_exceptions() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  threshold numeric := coalesce(
    (select (value #>> '{}')::numeric from settings where key = 'low_stock_threshold_pct'), 80);
  shed_cap numeric;
  shed_used numeric;
  occ numeric := 0;
begin
  perform gen_lot_exception(
    new.id, 'missing_bl'::exception_type, 'warning'::exception_severity,
    new.status = 'in_transit' and new.bl_number is null,
    'Lot ' || new.lot_number || ' is In Transit without a B/L number.');

  perform gen_lot_exception(
    new.id, 'missing_payment_terms'::exception_type, 'warning'::exception_severity,
    new.direction = 'export' and new.payment_terms is null,
    'Export lot ' || new.lot_number || ' has no payment terms.');

  -- Always evaluated so it auto-resolves when this lot leaves the shed.
  if new.status = 'stored' and new.shed_id is not null then
    select s.capacity_mt,
           coalesce(sum(l.quantity_mt) filter (where l.status = 'stored'), 0)
      into shed_cap, shed_used
      from sheds s left join lots l on l.shed_id = s.id
     where s.id = new.shed_id group by s.capacity_mt;
    occ := case when shed_cap > 0 then shed_used / shed_cap * 100 else 0 end;
  end if;
  perform gen_lot_exception(
    new.id, 'low_capacity'::exception_type,
    (case when occ >= 100 then 'critical' else 'warning' end)::exception_severity,
    new.status = 'stored' and occ > threshold,
    'Shed at ' || round(occ) || '% capacity after storing ' || new.lot_number || '.');

  return new;
end $$;

create trigger lots_sync_exceptions
  after insert or update on lots
  for each row execute function sync_lot_exceptions();

-- 1c. Overdue invoice exceptions (called on dashboard load). No amounts.
create or replace function public.refresh_overdue_exceptions() returns void
language plpgsql security definer set search_path = public as $$
begin
  insert into exceptions (lot_id, type, severity, description)
  select i.lot_id, 'overdue_invoice', 'warning',
         'Invoice ' || i.invoice_no || ' (' || c.name || ') is past due.'
    from invoices i join clients c on c.id = i.client_id
   where i.due_date < current_date and i.status <> 'paid'
     and not exists (
       select 1 from exceptions e
        where e.type = 'overdue_invoice' and e.status = 'open'
          and e.description like 'Invoice ' || i.invoice_no || ' %');

  update exceptions e set status = 'resolved', resolved_at = now(),
         note = coalesce(e.note, 'Auto-resolved: invoice settled')
   where e.type = 'overdue_invoice' and e.status = 'open'
     and not exists (
       select 1 from invoices i
        where i.due_date < current_date and i.status <> 'paid'
          and e.description like 'Invoice ' || i.invoice_no || ' %');
end $$;

grant execute on function public.refresh_overdue_exceptions() to authenticated;

-- 1d. Realtime publication (idempotent).
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and tablename = 'lots') then
    alter publication supabase_realtime add table lots;
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and tablename = 'exceptions') then
    alter publication supabase_realtime add table exceptions;
  end if;
end $$;
