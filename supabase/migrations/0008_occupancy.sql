create view public.shed_occupancy with (security_invoker = on) as
select
  s.id as shed_id,
  s.warehouse_id,
  s.name,
  s.capacity_mt,
  coalesce(sum(l.quantity_mt) filter (where l.status = 'stored'), 0) as stored_mt,
  case when s.capacity_mt > 0
    then round(coalesce(sum(l.quantity_mt) filter (where l.status = 'stored'), 0) / s.capacity_mt * 100, 1)
    else 0 end as occupancy_pct
from public.sheds s
left join public.lots l on l.shed_id = s.id
group by s.id, s.warehouse_id, s.name, s.capacity_mt;

grant select on public.shed_occupancy to authenticated, anon;
